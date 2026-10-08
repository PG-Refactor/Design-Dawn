//! Image import (drop flow), validation limits, cross-document copy and the `dawn-asset`
//! protocol response, all at the Application / response level (no Tauri window needed).
//! docs/testing.md covers the real IPC path in `ipc_contract.rs`.

mod support;

use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use design_dawn_lib::application::asset_import::{
    copy_asset_to_document, import_dropped_images, DropImportResult,
};
use design_dawn_lib::application::document_operations::{
    close_document, create_document, load_document,
};
use design_dawn_lib::application::dropped_files::{register_drop, DroppedFilesState};
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::window_registry::WindowRegistry;
use design_dawn_lib::commands::respond_to_asset_request;
use design_dawn_lib::domain::entity_id::ProjectId;
use design_dawn_lib::domain::error::DomainErrorKind;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::file_format::constants::ASSET_MAX_BYTES;
use support::*;
use tauri::http::Uri;

const SECOND_DOCUMENT_ID: &str = "01928f3a-0002-7aaa-8bbb-0123456789ab";
/// A well-formed UUID of the wrong version; ids are UUIDv7.
const UUID_V4: &str = "9b2f3c1e-4d5a-4b6c-8d7e-1f2a3b4c5d6e";
const FIXTURE_ASSET: &str = "assets/pixel.png";
const MIME_HEADER: &str = "content-type";
const CSP_HEADER: &str = "content-security-policy";
const NOSNIFF_HEADER: &str = "x-content-type-options";
const CACHE_HEADER: &str = "cache-control";
const WINDOW_LABEL: &str = "main";
const UNIX_HOST_FORM: &str = "dawn-asset://localhost";
const WINDOWS_HOST_FORM: &str = "http://dawn-asset.localhost";

fn bound_registry() -> WindowRegistry {
    let mut registry = WindowRegistry::default();
    registry
        .bind(WINDOW_LABEL, ProjectId::parse(PROJECT_ID).unwrap())
        .unwrap();
    registry
}

fn bound_registry_mutex() -> Mutex<WindowRegistry> {
    Mutex::new(bound_registry())
}

struct Fixture {
    opened: OpenedProject,
    sessions: Mutex<ProjectSessions>,
    drops: Mutex<DroppedFilesState>,
    registry: Mutex<WindowRegistry>,
    incoming: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let mut opened = open_copy();
        // Only an opened Document is served and may receive assets.
        load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
        create_document(
            &mut opened.sessions,
            PROJECT_ID,
            SECOND_DOCUMENT_ID,
            "Second",
            None,
        )
        .unwrap();
        let incoming = opened.temp.path().join("incoming");
        fs::create_dir_all(&incoming).unwrap();
        let sessions = Mutex::new(std::mem::take(&mut opened.sessions));
        Self {
            opened,
            sessions,
            drops: Mutex::new(DroppedFilesState::default()),
            registry: Mutex::new(bound_registry()),
            incoming,
        }
    }

    fn incoming_file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.incoming.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn drop_files(&self, paths: Vec<PathBuf>) -> String {
        register_drop(&self.drops, WINDOW_LABEL, paths)
            .unwrap()
            .drop_id
    }

    fn import(&self, paths: Vec<PathBuf>) -> DropImportResult {
        let drop_id = self.drop_files(paths);
        import_dropped_images(
            &self.sessions,
            &self.drops,
            WINDOW_LABEL,
            &drop_id,
            PROJECT_ID,
            DOCUMENT_ID,
        )
        .unwrap()
    }

    fn assets_of(&self, document_directory: &str) -> PathBuf {
        self.opened
            .root
            .join("documents")
            .join(document_directory)
            .join("assets")
    }

    fn first_assets(&self) -> PathBuf {
        document_dir(&self.opened.root).join("assets")
    }

    fn temp_text(&self) -> String {
        self.opened.temp.path().to_string_lossy().into_owned()
    }

    fn get(
        &self,
        host: &str,
        path: &str,
    ) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
        let uri: Uri = format!("{host}{path}").parse().unwrap();
        respond_to_asset_request(&self.sessions, &self.registry, WINDOW_LABEL, &uri)
    }

    fn close(&self, document_id: &str) {
        close_document(&mut self.sessions.lock().unwrap(), PROJECT_ID, document_id).unwrap();
    }

    fn asset_path(&self, document_id: &str, content_path: &str) -> String {
        format!("/{PROJECT_ID}/{document_id}/{content_path}")
    }
}

fn rejected_kinds(result: &DropImportResult) -> Vec<(String, &'static str)> {
    result
        .rejected
        .iter()
        .map(|rejected| (rejected.file_name.clone(), rejected.error.kind.as_str()))
        .collect()
}

fn header<'a>(
    response: &'a tauri::http::Response<std::borrow::Cow<'static, [u8]>>,
    name: &str,
) -> Option<&'a str> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
}

// ---- drop flow ----

#[test]
fn every_supported_format_is_imported_with_natural_and_initial_sizes() {
    let fixture = Fixture::new();
    let paths = vec![
        fixture.incoming_file("a.png", &png_bytes(1920, 1080)),
        fixture.incoming_file("b.JPG", &jpeg_bytes(1000, 2000)),
        fixture.incoming_file("c.jpeg", &jpeg_bytes(400, 300)),
        fixture.incoming_file("d.webp", &webp_bytes(1000, 1000)),
        fixture.incoming_file("e.gif", &gif_bytes(481, 10)),
        fixture.incoming_file("f.svg", svg_text(200, 100).as_bytes()),
    ];
    let result = fixture.import(paths);

    assert!(result.rejected.is_empty(), "{:?}", result.rejected);
    let summary: Vec<_> = result
        .imported
        .iter()
        .map(|image| {
            (
                image.content_path.as_str(),
                (image.natural_width, image.natural_height),
                (image.initial_width, image.initial_height),
                image.block_type,
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            ("assets/a.png", (1920, 1080), (480, 270), "image"),
            ("assets/b.jpg", (1000, 2000), (240, 480), "image"),
            ("assets/c.jpeg", (400, 300), (400, 300), "image"),
            ("assets/d.webp", (1000, 1000), (480, 480), "image"),
            ("assets/e.gif", (481, 10), (480, 10), "image"),
            ("assets/f.svg", (200, 100), (200, 100), "image"),
        ]
    );
    for image in &result.imported {
        assert!(document_dir(&fixture.opened.root)
            .join(&image.content_path)
            .is_file());
    }
}

#[test]
fn an_svg_without_a_size_gets_the_fallback_size() {
    let fixture = Fixture::new();
    let result =
        fixture.import(vec![fixture.incoming_file(
            "plain.svg",
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
        )]);
    assert_eq!(
        (
            result.imported[0].natural_width,
            result.imported[0].natural_height
        ),
        (320, 240)
    );
}

#[test]
fn rejected_files_are_reported_by_base_name_and_leave_nothing_behind() {
    let fixture = Fixture::new();
    let directory = fixture.incoming.join("folder.png");
    fs::create_dir(&directory).unwrap();
    let paths = vec![
        fixture.incoming_file("png-as-jpg.jpg", &png_bytes(1, 1)),
        fixture.incoming_file("page.svg", b"<html><body></body></html>"),
        fixture.incoming_file("nested.svg", b"<html><svg></svg></html>"),
        fixture.incoming_file("picture.bmp", b"BM"),
        fixture.incoming_file("scan.tiff", b"II*\0"),
        fixture.incoming_file("no-extension", &png_bytes(1, 1)),
        fixture.incoming_file("empty.png", b""),
        directory,
        fixture.incoming.join("absent.png"),
    ];
    let before = tree_snapshot(&fixture.opened.root);
    let result = fixture.import(paths);

    assert!(result.imported.is_empty());
    assert_eq!(
        rejected_kinds(&result),
        vec![
            ("png-as-jpg.jpg".to_owned(), "invalidImageContent"),
            ("page.svg".to_owned(), "invalidImageContent"),
            ("nested.svg".to_owned(), "invalidImageContent"),
            ("picture.bmp".to_owned(), "invalidContentExtension"),
            ("scan.tiff".to_owned(), "invalidContentExtension"),
            ("no-extension".to_owned(), "invalidContentExtension"),
            ("empty.png".to_owned(), "invalidImageContent"),
            ("folder.png".to_owned(), "invalidImageContent"),
            ("absent.png".to_owned(), "fileNotFound"),
        ]
    );
    assert_eq!(tree_snapshot(&fixture.opened.root), before);

    let temp_text = fixture.temp_text();
    for rejected in &result.rejected {
        assert!(!rejected.file_name.contains('/'), "{}", rejected.file_name);
        assert!(
            !rejected.error.detail.contains(&temp_text),
            "absolute path in {:?}",
            rejected.error.detail
        );
    }
}

#[test]
fn partial_success_imports_the_valid_files_in_drop_order() {
    let fixture = Fixture::new();
    let result = fixture.import(vec![
        fixture.incoming_file("good-1.png", &png_bytes(10, 10)),
        fixture.incoming_file("bad.png", b"not a png"),
        fixture.incoming_file("good-2.gif", &gif_bytes(5, 5)),
    ]);
    let imported: Vec<_> = result
        .imported
        .iter()
        .map(|i| i.content_path.as_str())
        .collect();
    assert_eq!(imported, vec!["assets/good-1.png", "assets/good-2.gif"]);
    assert_eq!(result.rejected.len(), 1);
    assert!(!fixture.first_assets().join("bad.png").exists());
}

#[test]
fn names_are_sanitized_collisions_get_a_suffix_and_nothing_is_overwritten() {
    let fixture = Fixture::new();
    let fixture_bytes = fs::read(fixture.first_assets().join("pixel.png")).unwrap();
    let first = fixture.incoming_file("pixel.png", &png_bytes(3, 3));
    let result = fixture.import(vec![
        first.clone(),
        first,
        fixture.incoming_file("My Photo (1).PNG", &png_bytes(2, 2)),
        fixture.incoming_file("写真.png", &png_bytes(2, 2)),
        fixture.incoming_file("nul.png", &png_bytes(2, 2)),
    ]);

    let paths: Vec<_> = result
        .imported
        .iter()
        .map(|i| i.content_path.as_str())
        .collect();
    assert_eq!(
        paths,
        vec![
            "assets/pixel-2.png",
            "assets/pixel-3.png",
            "assets/my-photo-1.png",
            "assets/image.png",
            "assets/image-2.png",
        ]
    );
    assert_eq!(
        fs::read(fixture.first_assets().join("pixel.png")).unwrap(),
        fixture_bytes
    );
}

#[test]
fn the_size_limit_accepts_exactly_the_limit_and_refuses_one_byte_more() {
    let fixture = Fixture::new();
    let header = png_bytes(8, 8);
    let write_sized = |name: &str, size: u64| {
        let path = fixture.incoming.join(name);
        let mut file = File::create(&path).unwrap();
        file.write_all(&header).unwrap();
        file.set_len(size).unwrap();
        path
    };
    let at_limit = write_sized("at-limit.png", ASSET_MAX_BYTES);
    let over_limit = write_sized("over-limit.png", ASSET_MAX_BYTES + 1);
    let result = fixture.import(vec![at_limit, over_limit]);

    assert_eq!(result.imported.len(), 1);
    assert_eq!(result.imported[0].content_path, "assets/at-limit.png");
    assert_eq!(
        rejected_kinds(&result),
        vec![("over-limit.png".to_owned(), "assetTooLarge")]
    );
    assert!(!fixture.first_assets().join("over-limit.png").exists());
}

#[test]
fn an_unknown_or_replaced_drop_id_is_invalid_drop_selection() {
    let fixture = Fixture::new();
    let old = fixture.drop_files(vec![fixture.incoming_file("a.png", &png_bytes(1, 1))]);
    fixture.drop_files(vec![fixture.incoming_file("b.png", &png_bytes(1, 1))]);
    for drop_id in [old.as_str(), "unknown", UNKNOWN_ID] {
        let error = import_dropped_images(
            &fixture.sessions,
            &fixture.drops,
            WINDOW_LABEL,
            drop_id,
            PROJECT_ID,
            DOCUMENT_ID,
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidDropSelection, "{drop_id}");
    }
}

#[test]
fn import_fails_as_a_whole_for_unknown_or_unwritable_targets() {
    let fixture = Fixture::new();
    let drop_id = fixture.drop_files(vec![fixture.incoming_file("a.png", &png_bytes(1, 1))]);
    let import = |project: &str, document: &str| {
        import_dropped_images(
            &fixture.sessions,
            &fixture.drops,
            WINDOW_LABEL,
            &drop_id,
            project,
            document,
        )
        .unwrap_err()
        .kind
    };
    assert_eq!(import(UNKNOWN_ID, DOCUMENT_ID), ErrorKind::ProjectNotOpen);
    assert_eq!(import(PROJECT_ID, UNKNOWN_ID), ErrorKind::EntityNotFound);
    assert_eq!(
        import(PROJECT_ID, "bad"),
        ErrorKind::Domain(DomainErrorKind::InvalidEntityId)
    );
    assert!(!fixture.first_assets().join("a.png").exists());
}

#[test]
fn a_document_that_failed_to_load_is_not_opened_and_not_writable() {
    let (temp, root) = project_copy();
    replace_in_file(
        &document_dir(&root).join("document.json"),
        "\"schemaVersion\": 1",
        "\"schemaVersion\": 2",
    );
    let mut sessions = ProjectSessions::default();
    design_dawn_lib::application::project_operations::open_project(&mut sessions, &root).unwrap();
    load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap_err();
    let sessions = Mutex::new(sessions);
    let drops = Mutex::new(DroppedFilesState::default());
    let source = temp.path().join("a.png");
    fs::write(&source, png_bytes(1, 1)).unwrap();
    let drop_id = register_drop(&drops, WINDOW_LABEL, vec![source])
        .unwrap()
        .drop_id;

    let error = import_dropped_images(
        &sessions,
        &drops,
        WINDOW_LABEL,
        &drop_id,
        PROJECT_ID,
        DOCUMENT_ID,
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    assert!(!document_dir(&root).join("assets").join("a.png").exists());
}

#[test]
fn import_into_a_document_that_was_never_loaded_fails_as_a_whole() {
    let mut opened = open_copy();
    let sessions = Mutex::new(std::mem::take(&mut opened.sessions));
    let drops = Mutex::new(DroppedFilesState::default());
    let source = opened.temp.path().join("a.png");
    fs::write(&source, png_bytes(1, 1)).unwrap();
    let drop_id = register_drop(&drops, WINDOW_LABEL, vec![source])
        .unwrap()
        .drop_id;

    let error = import_dropped_images(
        &sessions,
        &drops,
        WINDOW_LABEL,
        &drop_id,
        PROJECT_ID,
        DOCUMENT_ID,
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    assert!(!document_dir(&opened.root).join("assets/a.png").exists());
}

#[test]
fn import_into_a_closed_document_fails_as_a_whole() {
    let fixture = Fixture::new();
    fixture.close(DOCUMENT_ID);
    let drop_id = fixture.drop_files(vec![fixture.incoming_file("a.png", &png_bytes(1, 1))]);
    let error = import_dropped_images(
        &fixture.sessions,
        &fixture.drops,
        WINDOW_LABEL,
        &drop_id,
        PROJECT_ID,
        DOCUMENT_ID,
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    assert!(!fixture.first_assets().join("a.png").exists());
}

#[cfg(unix)]
#[test]
fn a_symlinked_assets_directory_cannot_redirect_an_import() {
    let fixture = Fixture::new();
    let outside = fixture.opened.temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::remove_dir_all(fixture.first_assets()).unwrap();
    std::os::unix::fs::symlink(&outside, fixture.first_assets()).unwrap();
    let result = fixture.import(vec![fixture.incoming_file("a.png", &png_bytes(1, 1))]);
    assert!(result.imported.is_empty());
    assert_eq!(
        rejected_kinds(&result),
        vec![("a.png".to_owned(), "pathOutsideRoot")]
    );
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
}

// ---- cross-document copy ----

#[test]
fn a_copy_keeps_the_name_and_suffixes_collisions() {
    let fixture = Fixture::new();
    let copy = || {
        copy_asset_to_document(
            &fixture.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            FIXTURE_ASSET,
            SECOND_DOCUMENT_ID,
        )
        .unwrap()
    };
    let first = copy();
    assert_eq!(first.content_path, "assets/pixel.png");
    assert_eq!((first.natural_width, first.natural_height), (1, 1));
    assert_eq!(copy().content_path, "assets/pixel-2.png");
    assert_eq!(copy().content_path, "assets/pixel-3.png");
    let source = fs::read(fixture.first_assets().join("pixel.png")).unwrap();
    for name in ["pixel.png", "pixel-2.png", "pixel-3.png"] {
        assert_eq!(
            fs::read(fixture.assets_of("second").join(name)).unwrap(),
            source
        );
    }
}

#[test]
fn copying_into_the_same_document_returns_the_same_path_without_copying() {
    let fixture = Fixture::new();
    let before = tree_snapshot(&fixture.opened.root);
    let copied = copy_asset_to_document(
        &fixture.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        FIXTURE_ASSET,
        DOCUMENT_ID,
    )
    .unwrap();
    assert_eq!(copied.content_path, FIXTURE_ASSET);
    assert_eq!((copied.natural_width, copied.natural_height), (1, 1));
    assert_eq!(tree_snapshot(&fixture.opened.root), before);
}

#[test]
fn a_copy_refuses_missing_invalid_and_unsafe_sources() {
    let fixture = Fixture::new();
    fs::write(fixture.first_assets().join("fake.png"), b"not a png").unwrap();
    fs::write(fixture.first_assets().join("page.svg"), b"<html></html>").unwrap();
    let before = tree_snapshot(&fixture.opened.root);
    let copy = |content_path: &str| {
        copy_asset_to_document(
            &fixture.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            content_path,
            SECOND_DOCUMENT_ID,
        )
        .unwrap_err()
        .kind
    };
    assert_eq!(
        copy("assets/missing.png"),
        ErrorKind::Persistence(PersistenceErrorKind::FileNotFound)
    );
    assert_eq!(copy("assets/fake.png"), ErrorKind::InvalidImageContent);
    assert_eq!(copy("assets/page.svg"), ErrorKind::InvalidImageContent);
    for unsafe_path in [
        "../document.json",
        "/etc/passwd",
        "assets/../document.json",
        "sheets/overview/sheet.json",
    ] {
        assert_eq!(
            copy(unsafe_path),
            ErrorKind::Domain(DomainErrorKind::InvalidContentPath),
            "{unsafe_path}"
        );
    }
    assert_eq!(
        copy("assets/pixel.txt"),
        ErrorKind::Domain(DomainErrorKind::InvalidContentExtension)
    );
    assert_eq!(tree_snapshot(&fixture.opened.root), before);
}

#[test]
fn a_copy_needs_known_documents_and_an_open_project() {
    let fixture = Fixture::new();
    let copy = |project: &str, source: &str, target: &str| {
        copy_asset_to_document(&fixture.sessions, project, source, FIXTURE_ASSET, target)
            .unwrap_err()
            .kind
    };
    assert_eq!(
        copy(UNKNOWN_ID, DOCUMENT_ID, SECOND_DOCUMENT_ID),
        ErrorKind::ProjectNotOpen
    );
    assert_eq!(
        copy(PROJECT_ID, UNKNOWN_ID, SECOND_DOCUMENT_ID),
        ErrorKind::EntityNotFound
    );
    assert_eq!(
        copy(PROJECT_ID, DOCUMENT_ID, UNKNOWN_ID),
        ErrorKind::EntityNotFound
    );
}

#[test]
fn a_copy_into_an_unopened_or_closed_target_fails() {
    let fixture = Fixture::new();
    let copy = |target: &str| {
        copy_asset_to_document(
            &fixture.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            FIXTURE_ASSET,
            target,
        )
    };
    fixture.close(SECOND_DOCUMENT_ID);
    assert_eq!(
        copy(SECOND_DOCUMENT_ID).unwrap_err().kind,
        ErrorKind::EntityNotFound
    );
    assert!(!fixture.assets_of("second").join("pixel.png").exists());
    // The same target in the source's own Document is refused too once it is closed.
    fixture.close(DOCUMENT_ID);
    assert_eq!(
        copy(DOCUMENT_ID).unwrap_err().kind,
        ErrorKind::EntityNotFound
    );
}

#[test]
fn a_copy_from_a_closed_source_into_an_opened_target_succeeds() {
    let fixture = Fixture::new();
    fixture.close(DOCUMENT_ID);
    let copied = copy_asset_to_document(
        &fixture.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        FIXTURE_ASSET,
        SECOND_DOCUMENT_ID,
    )
    .unwrap();
    assert_eq!(copied.content_path, FIXTURE_ASSET);
    assert_eq!(copied.natural_width, 1);
}

#[test]
fn a_copy_from_an_unknown_source_is_refused() {
    // The source only has to belong to the Project (it need not be open).
    let fixture = Fixture::new();
    let error = copy_asset_to_document(
        &fixture.sessions,
        PROJECT_ID,
        UNKNOWN_ID,
        FIXTURE_ASSET,
        SECOND_DOCUMENT_ID,
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
}

// ---- close_document ----

#[test]
fn close_document_validates_its_ids_and_touches_no_file() {
    let fixture = Fixture::new();
    let before = tree_snapshot(&fixture.opened.root);
    let mut sessions = fixture.sessions.lock().unwrap();
    assert_eq!(
        close_document(&mut sessions, UNKNOWN_ID, DOCUMENT_ID)
            .unwrap_err()
            .kind,
        ErrorKind::ProjectNotOpen
    );
    assert_eq!(
        close_document(&mut sessions, PROJECT_ID, UNKNOWN_ID)
            .unwrap_err()
            .kind,
        ErrorKind::EntityNotFound
    );
    assert_eq!(
        close_document(&mut sessions, PROJECT_ID, "bad")
            .unwrap_err()
            .kind,
        ErrorKind::Domain(DomainErrorKind::InvalidEntityId)
    );
    close_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    close_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    drop(sessions);
    assert_eq!(tree_snapshot(&fixture.opened.root), before);
}

// ---- dawn-asset protocol ----

#[test]
fn only_opened_documents_are_served() {
    let fixture = Fixture::new();
    let path = fixture.asset_path(DOCUMENT_ID, FIXTURE_ASSET);
    // Open Document.
    assert_eq!(fixture.get(UNIX_HOST_FORM, &path).status(), 200);
    // Never loaded: the Document belongs to the Project but nobody opened it.
    let (_temp, root) = project_copy();
    let mut never_loaded = ProjectSessions::default();
    design_dawn_lib::application::project_operations::open_project(&mut never_loaded, &root)
        .unwrap();
    let never_loaded = Mutex::new(never_loaded);
    let uri: Uri = format!("{UNIX_HOST_FORM}{path}").parse().unwrap();
    assert_eq!(
        respond_to_asset_request(&never_loaded, &bound_registry_mutex(), WINDOW_LABEL, &uri)
            .status(),
        404
    );
    // Loaded, then closed.
    fixture.close(DOCUMENT_ID);
    assert_eq!(fixture.get(UNIX_HOST_FORM, &path).status(), 404);
    // Another Project: an unknown valid id.
    let other = format!("/{UNKNOWN_ID}/{DOCUMENT_ID}/{FIXTURE_ASSET}");
    assert_eq!(fixture.get(UNIX_HOST_FORM, &other).status(), 404);
    // Invalid Document ID.
    let invalid = format!("/{PROJECT_ID}/not-an-id/{FIXTURE_ASSET}");
    assert_eq!(fixture.get(UNIX_HOST_FORM, &invalid).status(), 400);
}

#[test]
fn a_replaced_project_does_not_serve_the_documents_it_had_open() {
    let fixture = Fixture::new();
    let path = fixture.asset_path(DOCUMENT_ID, FIXTURE_ASSET);
    assert_eq!(fixture.get(UNIX_HOST_FORM, &path).status(), 200);
    // Opening another Project (here: the same files again) replaces the session, so no
    // Document is open in it until it is loaded.
    let (_temp, other_root) = project_copy();
    design_dawn_lib::application::project_operations::open_project(
        &mut fixture.sessions.lock().unwrap(),
        &other_root,
    )
    .unwrap();
    assert_eq!(fixture.get(UNIX_HOST_FORM, &path).status(), 404);
}

#[test]
fn a_valid_asset_is_served_with_its_bytes_and_hardening_headers_on_both_host_forms() {
    let fixture = Fixture::new();
    let expected = fs::read(fixture.first_assets().join("pixel.png")).unwrap();
    for host in [UNIX_HOST_FORM, WINDOWS_HOST_FORM] {
        let response = fixture.get(host, &fixture.asset_path(DOCUMENT_ID, FIXTURE_ASSET));
        assert_eq!(response.status(), 200, "{host}");
        assert_eq!(response.body().as_ref(), expected.as_slice());
        assert_eq!(header(&response, MIME_HEADER), Some("image/png"));
        assert_eq!(header(&response, NOSNIFF_HEADER), Some("nosniff"));
        assert_eq!(header(&response, CACHE_HEADER), Some("no-store"));
        assert_eq!(header(&response, CSP_HEADER), None);
    }
}

#[test]
fn each_format_has_its_mime_type_and_only_svg_carries_a_csp() {
    let fixture = Fixture::new();
    let assets = fixture.first_assets();
    let samples: [(&str, Vec<u8>, &str); 5] = [
        ("a.jpg", jpeg_bytes(1, 1), "image/jpeg"),
        ("b.jpeg", jpeg_bytes(1, 1), "image/jpeg"),
        ("c.webp", webp_bytes(1, 1), "image/webp"),
        ("d.gif", gif_bytes(1, 1), "image/gif"),
        ("e.svg", svg_text(1, 1).into_bytes(), "image/svg+xml"),
    ];
    for (name, bytes, mime) in samples {
        fs::write(assets.join(name), bytes).unwrap();
        let response = fixture.get(
            UNIX_HOST_FORM,
            &fixture.asset_path(DOCUMENT_ID, &format!("assets/{name}")),
        );
        assert_eq!(response.status(), 200, "{name}");
        assert_eq!(header(&response, MIME_HEADER), Some(mime));
        let expected_csp =
            (mime == "image/svg+xml").then_some("default-src 'none'; style-src 'unsafe-inline'");
        assert_eq!(header(&response, CSP_HEADER), expected_csp, "{name}");
    }
}

#[test]
fn percent_encoded_segments_are_decoded() {
    let fixture = Fixture::new();
    fs::write(fixture.first_assets().join("a b.png"), png_bytes(1, 1)).unwrap();
    let response = fixture.get(
        UNIX_HOST_FORM,
        &fixture.asset_path(DOCUMENT_ID, "assets/a%20b.png"),
    );
    assert_eq!(response.status(), 200);
}

#[test]
fn unsafe_or_unknown_urls_are_refused_without_leaking_paths() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.first_assets().join("directory.png")).unwrap();
    let cases: [(String, u16); 20] = [
        (fixture.asset_path(DOCUMENT_ID, "assets/missing.png"), 404),
        (
            fixture.asset_path(DOCUMENT_ID, "assets/../document.json"),
            400,
        ),
        (
            fixture.asset_path(DOCUMENT_ID, "assets/%2e%2e/document.json"),
            400,
        ),
        (fixture.asset_path(DOCUMENT_ID, "%2Fetc%2Fpasswd"), 400),
        (
            fixture.asset_path(DOCUMENT_ID, "assets/%2Fetc%2Fpasswd.png"),
            400,
        ),
        (fixture.asset_path(DOCUMENT_ID, "assets/a%5Cb.png"), 400),
        (
            fixture.asset_path(DOCUMENT_ID, "sheets/overview/sheet.json"),
            400,
        ),
        (fixture.asset_path(DOCUMENT_ID, "assets/pixel.txt"), 400),
        (fixture.asset_path(DOCUMENT_ID, "assets/%zz.png"), 400),
        (fixture.asset_path(DOCUMENT_ID, "assets/directory.png"), 404),
        (format!("/{UNKNOWN_ID}/{DOCUMENT_ID}/{FIXTURE_ASSET}"), 404),
        (format!("/{PROJECT_ID}/{UNKNOWN_ID}/{FIXTURE_ASSET}"), 404),
        (
            format!("/{PROJECT_ID}/{SECOND_DOCUMENT_ID}/{FIXTURE_ASSET}"),
            404,
        ),
        ("/nope".to_owned(), 400),
        (format!("/not-an-id/{DOCUMENT_ID}/{FIXTURE_ASSET}"), 400),
        (format!("/{PROJECT_ID}/not-an-id/{FIXTURE_ASSET}"), 400),
        (
            format!(
                "/{}/{DOCUMENT_ID}/{FIXTURE_ASSET}",
                PROJECT_ID.to_uppercase()
            ),
            400,
        ),
        (
            format!(
                "/{PROJECT_ID}/{}/{FIXTURE_ASSET}",
                DOCUMENT_ID.to_uppercase()
            ),
            400,
        ),
        (format!("/{UUID_V4}/{DOCUMENT_ID}/{FIXTURE_ASSET}"), 400),
        // The drive letter and backslash are percent-encoded, so only decoding reveals them.
        (fixture.asset_path(DOCUMENT_ID, "assets/C%3A%5Cx.png"), 400),
    ];
    let temp_text = fixture.temp_text();
    for (path, status) in cases {
        let response = fixture.get(UNIX_HOST_FORM, &path);
        assert_eq!(response.status(), status, "{path}");
        let body = String::from_utf8_lossy(response.body());
        assert!(
            !body.contains(&temp_text) && !body.contains('/'),
            "{path}: {body}"
        );
    }
}

/// Decoding happens once; a second level of encoding must stay a plain (unknown) file name,
/// never become a `..` segment.
#[test]
fn a_double_encoded_traversal_is_not_served() {
    let fixture = Fixture::new();
    let response = fixture.get(
        UNIX_HOST_FORM,
        &fixture.asset_path(DOCUMENT_ID, "assets/%252e%252e/document.json"),
    );
    assert_ne!(response.status(), 200);
    let body = String::from_utf8_lossy(response.body());
    assert!(
        !body.contains(&fixture.temp_text()) && !body.contains('/'),
        "{body}"
    );
}

#[test]
fn an_asset_too_large_is_refused_before_it_is_read() {
    let fixture = Fixture::new();
    let file = File::create(fixture.first_assets().join("huge.png")).unwrap();
    file.set_len(ASSET_MAX_BYTES + 1).unwrap();
    let response = fixture.get(
        UNIX_HOST_FORM,
        &fixture.asset_path(DOCUMENT_ID, "assets/huge.png"),
    );
    assert_eq!(response.status(), 413);
}

#[cfg(unix)]
mod symlinks {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    const NO_PERMISSION_MODE: u32 = 0o000;
    const UNREADABLE_ASSET_STATUS: u16 = 500;

    #[test]
    fn an_unreadable_asset_is_an_error_without_a_path() {
        let fixture = Fixture::new();
        let file = fixture.first_assets().join("locked.png");
        fs::write(&file, png_bytes(1, 1)).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(NO_PERMISSION_MODE)).unwrap();
        // `root` ignores file modes, so the failure cannot be provoked there.
        if fs::File::open(&file).is_ok() {
            return;
        }
        let response = fixture.get(
            UNIX_HOST_FORM,
            &fixture.asset_path(DOCUMENT_ID, "assets/locked.png"),
        );
        assert_eq!(response.status(), UNREADABLE_ASSET_STATUS);
        let body = String::from_utf8_lossy(response.body());
        assert!(
            !body.contains(&fixture.temp_text()) && !body.contains('/'),
            "{body}"
        );
    }

    #[test]
    fn a_symlink_leaving_the_document_is_forbidden() {
        let fixture = Fixture::new();
        let outside = fixture.opened.temp.path().join("secret.png");
        fs::write(&outside, png_bytes(1, 1)).unwrap();
        symlink(&outside, fixture.first_assets().join("link.png")).unwrap();
        let response = fixture.get(
            UNIX_HOST_FORM,
            &fixture.asset_path(DOCUMENT_ID, "assets/link.png"),
        );
        assert_eq!(response.status(), 403);
        assert!(!String::from_utf8_lossy(response.body()).contains(&fixture.temp_text()));
    }

    #[test]
    fn a_symlink_to_another_documents_asset_is_forbidden() {
        let fixture = Fixture::new();
        copy_asset_to_document(
            &fixture.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            FIXTURE_ASSET,
            SECOND_DOCUMENT_ID,
        )
        .unwrap();
        symlink(
            fixture.assets_of("second").join("pixel.png"),
            fixture.first_assets().join("borrowed.png"),
        )
        .unwrap();
        let response = fixture.get(
            UNIX_HOST_FORM,
            &fixture.asset_path(DOCUMENT_ID, "assets/borrowed.png"),
        );
        assert_eq!(response.status(), 403);
    }

    #[test]
    fn a_symlinked_assets_directory_is_forbidden() {
        let fixture = Fixture::new();
        let outside = fixture.opened.temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("a.png"), png_bytes(1, 1)).unwrap();
        fs::remove_dir_all(fixture.first_assets()).unwrap();
        symlink(&outside, fixture.first_assets()).unwrap();
        let response = fixture.get(
            UNIX_HOST_FORM,
            &fixture.asset_path(DOCUMENT_ID, "assets/a.png"),
        );
        assert_eq!(response.status(), 403);
    }

    #[test]
    fn a_copy_never_follows_a_symlink_out_of_the_source_document() {
        let fixture = Fixture::new();
        let outside = fixture.opened.temp.path().join("secret.png");
        fs::write(&outside, png_bytes(1, 1)).unwrap();
        symlink(&outside, fixture.first_assets().join("link.png")).unwrap();
        let error = copy_asset_to_document(
            &fixture.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            "assets/link.png",
            SECOND_DOCUMENT_ID,
        )
        .unwrap_err();
        assert_eq!(
            error.kind,
            ErrorKind::Persistence(PersistenceErrorKind::PathOutsideRoot)
        );
        assert!(!error.detail.contains(&fixture.temp_text()));
    }
}
