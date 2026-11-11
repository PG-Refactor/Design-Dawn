//! Commands of "Export Documents…": choose a folder, see which files would be replaced, and
//! write each Document into the folder as Markdown, HTML or PDF. The Frontend holds a token
//! for the folder, never its path.

use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager, Runtime, Window};

use super::pdf_printer::{print_html_to_pdf, PageExtent};
use super::{
    ensure_window_project, percent_decoded, project_root, run_blocking, SharedFolderPicker,
};
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::export_file::{suggested_name, ExportKind};
use crate::application::export_folder::{
    existing_files, subfolder, write_into_folder, ExportFolderChoice, ExportFolderFile,
    ExportFolders,
};
use crate::application::export_markdown::export_document_markdown_into;
use crate::application::export_markdown::write_file_atomically;
use crate::application::file_dialogs::SaveOutcome;

const HEADER_FOLDER: &str = "x-dawn-export-folder";
const HEADER_NAME: &str = "x-dawn-export-name";
const HEADER_FORMAT: &str = "x-dawn-export-kind";
const HEADER_PAGE: &str = "x-dawn-export-page";
/// The Project folders a file goes into: each percent-encoded, joined by `/`.
const HEADER_SUBFOLDER: &str = "x-dawn-export-subfolder";
const SUBFOLDER_SEPARATOR: char = '/';
const PDF_FORMAT: &str = "pdf";
const PAGE_SEPARATOR: char = ',';

fn folder_of<R: Runtime>(app: &AppHandle<R>, token: &str) -> ApplicationResult<std::path::PathBuf> {
    app.state::<Mutex<ExportFolders>>()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .folder(token)
}

/// The folder dialog; the chosen folder is kept under a token for the writes that follow.
/// The dialog runs without the lock, which is taken only to record the answer.
#[tauri::command]
pub async fn choose_export_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ExportFolderChoice, ApplicationError> {
    run_blocking(move || {
        let picker = app.try_state::<SharedFolderPicker>().ok_or_else(|| {
            ApplicationError::new(ErrorKind::DialogFailed, "no folder picker is registered")
        })?;
        let Some(folder) = picker.inner().pick_folder(None)? else {
            return Ok(ExportFolderChoice::Cancelled);
        };
        Ok(app
            .state::<Mutex<ExportFolders>>()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remember(folder))
    })
    .await
}

/// The names of the files that would be replaced in the folder.
#[tauri::command]
pub async fn export_folder_existing<R: Runtime>(
    app: AppHandle<R>,
    folder: String,
    files: Vec<ExportFolderFile>,
) -> Result<Vec<String>, ApplicationError> {
    let path = folder_of(&app, &folder)?;
    run_blocking(move || existing_files(&path, &files)).await
}

/// One Document as `<stem>.md` (and `<stem>-assets/`) in the folder. Reads the files on disk,
/// so the Frontend saves first.
#[tauri::command]
pub async fn export_markdown_into_folder<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    document_id: String,
    folder: String,
    stem: String,
    folders: Vec<String>,
) -> Result<String, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    let root = project_root(&app, &project_id)?;
    let path = subfolder(&folder_of(&app, &folder)?, &folders);
    run_blocking(move || export_document_markdown_into(&root, &document_id, &path, &stem)).await
}

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> ApplicationResult<String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| ApplicationError::new(ErrorKind::ExportFailed, format!("missing {name}")))
}

/// The subfolder header: empty for the chosen folder itself.
fn subfolders(request: &tauri::ipc::Request<'_>) -> Vec<String> {
    request
        .headers()
        .get(HEADER_SUBFOLDER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .split(SUBFOLDER_SEPARATOR)
                .map(percent_decoded)
                .collect()
        })
        .unwrap_or_default()
}

fn raw_body(request: &tauri::ipc::Request<'_>) -> ApplicationResult<Vec<u8>> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(ApplicationError::new(
            ErrorKind::ExportFailed,
            "body is not raw bytes",
        ));
    };
    Ok(bytes.clone())
}

/// An HTML page the Frontend made, written into the folder (body: the page; headers: the
/// folder token, the format and the stem, percent-encoded).
#[tauri::command]
pub async fn export_into_folder<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, ApplicationError> {
    let path = subfolder(
        &folder_of(&app, &header(&request, HEADER_FOLDER)?)?,
        &subfolders(&request),
    );
    let format = header(&request, HEADER_FORMAT)?;
    let stem = percent_decoded(&header(&request, HEADER_NAME)?);
    let bytes = raw_body(&request)?;
    run_blocking(move || write_into_folder(&path, &format, &stem, &bytes)).await
}

fn parse_page(text: &str) -> ApplicationResult<PageExtent> {
    let invalid = || ApplicationError::new(ErrorKind::ExportFailed, "invalid page size");
    let (width, height) = text.split_once(PAGE_SEPARATOR).ok_or_else(invalid)?;
    let width: f64 = width.trim().parse().map_err(|_| invalid())?;
    let height: f64 = height.trim().parse().map_err(|_| invalid())?;
    if !(width > 0.0 && height > 0.0 && width.is_finite() && height.is_finite()) {
        return Err(invalid());
    }
    Ok(PageExtent { width, height })
}

/// An HTML page printed to PDF (without a dialog) and written into the folder. Headers as
/// for `export_into_folder`, plus the largest page size (`width,height` in CSS pixels).
#[tauri::command]
pub async fn export_pdf_into_folder<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, ApplicationError> {
    let path = subfolder(
        &folder_of(&app, &header(&request, HEADER_FOLDER)?)?,
        &subfolders(&request),
    );
    let stem = percent_decoded(&header(&request, HEADER_NAME)?);
    let page = parse_page(&header(&request, HEADER_PAGE)?)?;
    let html = String::from_utf8(raw_body(&request)?)
        .map_err(|_| ApplicationError::new(ErrorKind::ExportFailed, "the page is not UTF-8"))?;
    run_blocking(move || {
        let pdf = print_html_to_pdf(&app, &html, page)?;
        write_into_folder(&path, PDF_FORMAT, &stem, &pdf)
    })
    .await
}

/// One PDF through the save dialog (the shown sheet or Document): body and headers as for
/// `export_pdf_into_folder`, without the folder. The page is printed after the dialog.
#[tauri::command]
pub async fn export_pdf_file<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<SaveOutcome, ApplicationError> {
    let stem = percent_decoded(&header(&request, HEADER_NAME)?);
    let page = parse_page(&header(&request, HEADER_PAGE)?)?;
    let html = String::from_utf8(raw_body(&request)?)
        .map_err(|_| ApplicationError::new(ErrorKind::ExportFailed, "the page is not UTF-8"))?;
    run_blocking(move || {
        let dialogs = super::file_dialogs(&app)?;
        let Some(target) = dialogs.save_file(
            ExportKind::Pdf.filter(),
            &suggested_name(&stem, ExportKind::Pdf),
        )?
        else {
            return Ok(SaveOutcome::Cancelled);
        };
        let pdf = print_html_to_pdf(&app, &html, page)?;
        write_file_atomically(&target, &pdf)?;
        Ok(SaveOutcome::Saved {
            file_name: target
                .file_name()
                .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_sizes_are_two_positive_numbers() {
        assert_eq!(
            parse_page("794, 1123.5").unwrap(),
            PageExtent {
                width: 794.0,
                height: 1123.5
            }
        );
        assert!(parse_page("0,10").is_err());
        assert!(parse_page("10").is_err());
        assert!(parse_page("a,b").is_err());
    }
}
