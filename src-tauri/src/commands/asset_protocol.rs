//! The read-only `dawn-asset` URL scheme through which the UI displays image assets
//! (docs/security.md §8). The handler only turns a URL into an Application call
//! (`read_asset_for_url`) and the result into an HTTP response; all path validation lives in
//! the Application layer.
//!
//! URL form: `/<projectId>/<documentId>/<contentPath>` with every segment percent-encoded.
//! Tauri serves the scheme as `dawn-asset://localhost/...` on Linux and macOS and as
//! `http://dawn-asset.localhost/...` on Windows. Only the path is used, so both host forms
//! are handled identically.

use std::borrow::Cow;
use std::sync::{Mutex, PoisonError};

use tauri::http::header::{
    CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS,
};
use tauri::http::{Response, StatusCode, Uri};

use crate::application::asset_import::read_asset_for_url;
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::session::ProjectSessions;
use crate::application::window_registry::WindowRegistry;
use crate::domain::constants::PATH_SEPARATOR;
use crate::domain::entity_id::ProjectId;
use crate::infrastructure::error::PersistenceErrorKind;
use crate::infrastructure::file_format::image_validation::ImageFormat;

pub const ASSET_URL_SCHEME: &str = "dawn-asset";

const NO_SNIFF: &str = "nosniff";
const NO_STORE: &str = "no-store";
/// Defense in depth for SVG: `<img>` already runs no scripts and loads no subresources.
const SVG_CONTENT_SECURITY_POLICY: &str = "default-src 'none'; style-src 'unsafe-inline'";
const ERROR_CONTENT_TYPE: &str = "text/plain; charset=utf-8";
const PERCENT: u8 = b'%';
const HEX_RADIX: u32 = 16;
const PERCENT_ESCAPE_LENGTH: usize = 3;
const PROJECT_SEGMENT_COUNT: usize = 2;

type AssetResponse = Response<Cow<'static, [u8]>>;

/// A URL that cannot name an asset at all (as opposed to one naming a missing asset).
struct MalformedUrl;

fn percent_decode(segment: &str) -> Result<String, MalformedUrl> {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == PERCENT {
            let digits = bytes
                .get(index + 1..index + PERCENT_ESCAPE_LENGTH)
                .and_then(|pair| std::str::from_utf8(pair).ok())
                .and_then(|pair| u8::from_str_radix(pair, HEX_RADIX).ok())
                .ok_or(MalformedUrl)?;
            decoded.push(digits);
            index += PERCENT_ESCAPE_LENGTH;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| MalformedUrl)
}

/// `(projectId, documentId, contentPath)`. A decoded `/` inside one segment is refused so an
/// encoded separator cannot smuggle extra path levels past the segment-wise rules.
fn parse_asset_path(path: &str) -> Result<(String, String, String), MalformedUrl> {
    let relative = path.strip_prefix(PATH_SEPARATOR).ok_or(MalformedUrl)?;
    let segments = relative
        .split(PATH_SEPARATOR)
        .map(|segment| {
            let decoded = percent_decode(segment)?;
            if decoded.contains(PATH_SEPARATOR) {
                Err(MalformedUrl)
            } else {
                Ok(decoded)
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (identifiers, content) = segments
        .split_at_checked(PROJECT_SEGMENT_COUNT)
        .ok_or(MalformedUrl)?;
    let [project_id, document_id] = identifiers else {
        return Err(MalformedUrl);
    };
    if content.is_empty() {
        return Err(MalformedUrl);
    }
    Ok((
        project_id.clone(),
        document_id.clone(),
        content.join(&PATH_SEPARATOR.to_string()),
    ))
}

fn status_for(error: &ApplicationError) -> StatusCode {
    match error.kind {
        ErrorKind::Persistence(PersistenceErrorKind::PathOutsideRoot) => StatusCode::FORBIDDEN,
        // "Not an asset": missing, unknown, or not a regular file at that location.
        ErrorKind::ProjectNotOpen
        | ErrorKind::EntityNotFound
        | ErrorKind::InvalidImageContent
        | ErrorKind::Persistence(PersistenceErrorKind::FileNotFound) => StatusCode::NOT_FOUND,
        ErrorKind::AssetTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        ErrorKind::Domain(_) => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// The body is the error identifier only: `detail` can mention names inside the Project and
/// is developer-facing, so it never goes into a response.
fn error_response(status: StatusCode, identifier: &str) -> AssetResponse {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, ERROR_CONTENT_TYPE)
        .header(X_CONTENT_TYPE_OPTIONS, NO_SNIFF)
        .header(CACHE_CONTROL, NO_STORE)
        .body(Cow::Owned(identifier.as_bytes().to_vec()))
        .expect("static response parts are valid")
}

/// Only the Project bound to the requesting webview's window is served; another window's
/// Project answers like an unknown one (404).
fn ensure_served_to_window(
    registry: &Mutex<WindowRegistry>,
    webview_label: &str,
    project_id: &str,
) -> ApplicationResult<()> {
    let project_id = ProjectId::parse(project_id)?;
    registry
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .ensure_bound(webview_label, &project_id)
}

/// Builds the whole HTTP response for one asset request from the webview `webview_label`.
pub fn respond_to_asset_request(
    sessions: &Mutex<ProjectSessions>,
    registry: &Mutex<WindowRegistry>,
    webview_label: &str,
    uri: &Uri,
) -> AssetResponse {
    let Ok((project_id, document_id, content_path)) = parse_asset_path(uri.path()) else {
        return error_response(StatusCode::BAD_REQUEST, "malformedAssetUrl");
    };
    if let Err(error) = ensure_served_to_window(registry, webview_label, &project_id) {
        return error_response(status_for(&error), error.kind.as_str());
    }
    match read_asset_for_url(sessions, &project_id, &document_id, &content_path) {
        Ok(asset) => {
            let mut builder = Response::builder()
                .status(StatusCode::OK)
                .header(CONTENT_TYPE, asset.mime_type())
                .header(X_CONTENT_TYPE_OPTIONS, NO_SNIFF)
                .header(CACHE_CONTROL, NO_STORE);
            if asset.format == ImageFormat::Svg {
                builder = builder.header(CONTENT_SECURITY_POLICY, SVG_CONTENT_SECURITY_POLICY);
            }
            builder
                .body(Cow::Owned(asset.bytes))
                .expect("static response parts are valid")
        }
        Err(error) => error_response(status_for(&error), error.kind.as_str()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(path: &str) -> Option<(String, String, String)> {
        parse_asset_path(path).ok()
    }

    #[test]
    fn a_well_formed_path_is_split_into_ids_and_content_path() {
        assert_eq!(
            parse("/p/d/assets/a%20b.png"),
            Some(("p".into(), "d".into(), "assets/a b.png".into()))
        );
        assert_eq!(
            parse("/p/d/assets/%E5%86%99.png"),
            Some(("p".into(), "d".into(), "assets/写.png".into()))
        );
    }

    #[test]
    fn malformed_paths_are_refused() {
        for path in [
            "",
            "p/d/assets/a.png",
            "/",
            "/p",
            "/p/d",
            "/p/d/assets/%zz.png",
            "/p/d/assets/%2",
            "/p/d/assets%2Fa.png",
            "/p/d/assets/%FF.png",
        ] {
            assert!(parse(path).is_none(), "{path}");
        }
    }

    #[test]
    fn traversal_is_left_to_the_content_path_rules() {
        // Not rejected here (the Application layer owns path rules), but it is decoded so
        // that `%2e%2e` cannot hide from them.
        assert_eq!(
            parse("/p/d/%2e%2e/x.png"),
            Some(("p".into(), "d".into(), "../x.png".into()))
        );
    }

    #[test]
    fn statuses_follow_the_error_kind() {
        let status = |kind| status_for(&ApplicationError::new(kind, "x"));
        assert_eq!(
            status(ErrorKind::Persistence(
                PersistenceErrorKind::PathOutsideRoot
            )),
            StatusCode::FORBIDDEN
        );
        assert_eq!(status(ErrorKind::ProjectNotOpen), StatusCode::NOT_FOUND);
        assert_eq!(
            status(ErrorKind::Persistence(PersistenceErrorKind::FileNotFound)),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            status(ErrorKind::Persistence(PersistenceErrorKind::IoError)),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            status(ErrorKind::AssetTooLarge),
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }
}
