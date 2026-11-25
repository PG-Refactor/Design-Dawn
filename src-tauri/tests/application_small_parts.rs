//! Small parts of the application layer the app calls directly: a Document asset read as a
//! `data:` URL and as bytes, generated ids, and how sessions and errors describe themselves.

mod support;

use std::sync::Mutex;

use design_dawn_lib::application::asset_import::{asset_data_url, read_document_asset};
use design_dawn_lib::application::document_operations::load_document;
use design_dawn_lib::application::entity_id_generator::generate_folder_id;
use design_dawn_lib::application::folder_selection::FolderPickerError;
use design_dawn_lib::domain::entity_id::FolderId;
use support::*;

const DOCUMENT_ID: &str = "01928f3a-6c7d-7e8f-a012-3456789abcde";
const PICTURE: &str = "assets/pixel.png";

#[test]
fn a_document_asset_is_read_as_bytes_and_as_a_data_url() {
    let mut opened = open_copy();
    let project_id = opened.snapshot.project.project_id.clone();
    load_document(&mut opened.sessions, &project_id, DOCUMENT_ID).unwrap();
    let sessions = Mutex::new(opened.sessions);
    let (name, bytes) = read_document_asset(&sessions, &project_id, DOCUMENT_ID, PICTURE).unwrap();
    assert_eq!(name, "pixel.png");
    assert!(!bytes.is_empty());
    let url = asset_data_url(&sessions, &project_id, DOCUMENT_ID, PICTURE).unwrap();
    assert!(url.starts_with("data:image/png;base64,"));
    assert!(read_document_asset(&sessions, &project_id, "not-an-id", PICTURE).is_err());
    assert!(asset_data_url(&sessions, &project_id, DOCUMENT_ID, "assets/none.png").is_err());
}

#[test]
fn a_generated_folder_id_is_a_valid_folder_id() {
    let id = generate_folder_id();
    assert_eq!(FolderId::parse(&id.to_string()).unwrap(), id);
}

#[test]
fn sessions_and_picker_errors_describe_themselves() {
    let opened = open_copy();
    assert!(format!("{:?}", opened.sessions).contains("ProjectSessions"));
    assert_eq!(FolderPickerError::new("closed").to_string(), "closed");
}
