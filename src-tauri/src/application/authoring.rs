//! Compound write operations: the sequences the Frontend composes from several Commands
//! (create content, then list it in the sheet; create a Document, then list it in its parent),
//! available to a process that has no Frontend, such as the MCP server. Each function takes the already loaded parent state, so the caller decides how fresh
//! it is; the session's hash ledger then refuses a write if that state changed on disk since
//! it was read.
//!
//! The ordering rules are the Frontend's: content files are
//! created before the metadata that lists them, and removed after the metadata stops listing
//! them.

use std::fs;

use serde_json::Number;

use super::block_content_operations::{
    create_block_content, delete_block_content, is_text_block_type, write_block_content,
};
use super::document_operations::{create_document, delete_document, save_document};
use super::entity_id_generator::{generate_block_id, generate_document_id, generate_sheet_id};
use super::error::{ApplicationError, ApplicationResult};
use super::folder_operations::save_folder;
use super::project_operations::save_project;
use super::session::ProjectSessions;
use super::sheet_operations::{create_sheet, delete_sheet, save_sheet};
use super::snapshot::{DocumentSnapshot, ProjectSnapshot, SheetSnapshot};
use crate::domain::block_type::BlockType;
use crate::domain::constants::CURRENT_FOLDER_SCHEMA_VERSION;
use crate::domain::display_name::DisplayName;
use crate::domain::entity_id::{BlockId, DocumentId};
use crate::domain::error::DomainError;
use crate::domain::geometry::{Position, Size};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::constants::ASSET_MAX_BYTES;
use crate::infrastructure::file_format::dto::{
    BlockDto, DocumentDto, FolderDto, PositionDto, SheetDto, SizeDto,
};
use crate::infrastructure::file_format::image_dimensions::natural_size;
use crate::infrastructure::file_format::image_validation::{validate_image_content, ImageFormat};
use crate::infrastructure::filesystem::hashing::sha256_hex;
use crate::infrastructure::filesystem::text_content::{decode_text, encode_text};

/// Block text files are small; the same bound as the comparison view's disk side.
pub const BLOCK_TEXT_MAX_BYTES: u64 = super::block_content_operations::COMPARE_MAX_BYTES;

/// Why a compound operation did not happen. `Conflict` and `TextTooLarge` are first-class
/// because callers answer them differently from a failure: a conflict means "read again and
/// retry", not "something is broken".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthoringError {
    /// The file on disk is not what the caller based its change on.
    Conflict,
    TextTooLarge {
        limit_bytes: u64,
    },
    Failed(ApplicationError),
}

impl From<ApplicationError> for AuthoringError {
    fn from(error: ApplicationError) -> Self {
        use super::error::ErrorKind;
        if error.kind == ErrorKind::Persistence(PersistenceErrorKind::ExternallyModified) {
            Self::Conflict
        } else {
            Self::Failed(error)
        }
    }
}

impl From<DomainError> for AuthoringError {
    fn from(error: DomainError) -> Self {
        Self::Failed(error.into())
    }
}

impl From<PersistenceError> for AuthoringError {
    fn from(error: PersistenceError) -> Self {
        ApplicationError::from(error).into()
    }
}

pub type AuthoringResult<T> = Result<T, AuthoringError>;

/// Where and how large a new or moved Block is, in world units.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlockGeometry {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

/// A text Block's content as stored. `content_hash` is the SHA-256 of the file bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextBlockContent {
    pub text: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextBlockWrite {
    pub content_hash: String,
    /// False when the file already held this text and was left untouched.
    pub written: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockRemoval {
    /// False for an Image Block (its asset stays) and when the content file could not be
    /// deleted after the Block was unlisted (it is then reported as an orphan on load).
    pub content_file_removed: bool,
}

fn normalized_name(name: &str) -> Result<String, DomainError> {
    Ok(DisplayName::new(name.trim())?.as_str().to_owned())
}

/// Creates a Document and lists it last in its parent (the Project or a Folder), like the
/// app's "new Document". The Document starts without a Sheet, as in the app. If listing it
/// fails the new directory is removed again, so no unlisted Document is left behind.
pub fn create_listed_document(
    sessions: &mut ProjectSessions,
    project_id: &str,
    project: &ProjectSnapshot,
    name: &str,
    parent_folder_id: Option<&str>,
) -> AuthoringResult<DocumentSnapshot> {
    let name = normalized_name(name)?;
    let document_id = generate_document_id().to_string();
    let snapshot = create_document(sessions, project_id, &document_id, &name, parent_folder_id)?;
    if let Err(error) = list_in_parent(
        sessions,
        project_id,
        project,
        parent_folder_id,
        &document_id,
    ) {
        // Best effort: the directory was created a moment ago by this very call.
        let _ = delete_document(sessions, project_id, &document_id);
        return Err(error);
    }
    Ok(snapshot)
}

fn list_in_parent(
    sessions: &mut ProjectSessions,
    project_id: &str,
    project: &ProjectSnapshot,
    parent_folder_id: Option<&str>,
    entry_id: &str,
) -> AuthoringResult<()> {
    match parent_folder_id {
        None => {
            let mut dto = project.project.clone();
            dto.child_order.push(entry_id.to_owned());
            save_project(sessions, project_id, &dto)?;
        }
        Some(folder_id) => {
            let folder = project
                .folders
                .iter()
                .find(|folder| folder.folder_id == folder_id)
                .ok_or_else(|| {
                    ApplicationError::entity_not_found(format!("unknown folderId: {folder_id}"))
                })?;
            let name = folder.name.clone().ok_or_else(|| {
                ApplicationError::not_writable(format!(
                    "folder {folder_id} did not load and cannot be written"
                ))
            })?;
            let mut child_order = folder.child_order.clone();
            child_order.push(entry_id.to_owned());
            save_folder(
                sessions,
                project_id,
                &FolderDto {
                    schema_version: Number::from(CURRENT_FOLDER_SCHEMA_VERSION),
                    folder_id: folder.folder_id.clone(),
                    name,
                    child_order,
                },
            )?;
        }
    }
    Ok(())
}

/// Creates a Sheet and lists it last in the Document. Removes the new Sheet again if the
/// Document cannot be saved.
pub fn create_listed_sheet(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document: &DocumentDto,
    name: &str,
) -> AuthoringResult<SheetSnapshot> {
    let name = normalized_name(name)?;
    let sheet_id = generate_sheet_id().to_string();
    let snapshot = create_sheet(
        sessions,
        project_id,
        &document.document_id,
        &sheet_id,
        &name,
    )?;
    let mut listed = document.clone();
    listed.sheet_order.push(sheet_id.clone());
    if let Err(error) = save_document(sessions, project_id, &listed) {
        let _ = delete_sheet(sessions, project_id, &document.document_id, &sheet_id);
        return Err(error.into());
    }
    Ok(snapshot)
}

pub fn rename_document(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document: &DocumentDto,
    name: &str,
) -> AuthoringResult<DocumentDto> {
    let mut renamed = document.clone();
    renamed.name = normalized_name(name)?;
    save_document(sessions, project_id, &renamed)?;
    Ok(renamed)
}

pub fn rename_sheet(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet: &SheetDto,
    name: &str,
) -> AuthoringResult<SheetDto> {
    let mut renamed = sheet.clone();
    renamed.name = normalized_name(name)?;
    save_sheet(sessions, project_id, document_id, &renamed)?;
    Ok(renamed)
}

pub fn find_block<'a>(sheet: &'a SheetDto, block_id: &str) -> ApplicationResult<&'a BlockDto> {
    let block_id = BlockId::parse(block_id)?.to_string();
    sheet
        .blocks
        .iter()
        .find(|block| block.block_id == block_id)
        .ok_or_else(|| ApplicationError::entity_not_found(format!("unknown blockId: {block_id}")))
}

fn require_text_block(block: &BlockDto) -> ApplicationResult<BlockType> {
    let block_type = BlockType::parse(&block.block_type)?;
    if is_text_block_type(block_type) {
        Ok(block_type)
    } else {
        Err(DomainError::new(
            crate::domain::error::DomainErrorKind::UnsupportedBlockType,
            format!("{} has no text content", block_type.as_str()),
        )
        .into())
    }
}

/// Reads a text Block's file with its hash. Refuses files above `BLOCK_TEXT_MAX_BYTES`
/// before reading them, so a huge file cannot be pulled into memory.
pub fn read_text_block(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    block: &BlockDto,
) -> AuthoringResult<TextBlockContent> {
    require_text_block(block)?;
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let base = session.document_base(&document_id)?;
    let path = session.resolve_existing_path(&base, &block.content_path)?;
    let size = fs::metadata(&path)
        .map_err(|error| PersistenceError::from_io("stat block content", &error))?
        .len();
    if size > BLOCK_TEXT_MAX_BYTES {
        return Err(AuthoringError::TextTooLarge {
            limit_bytes: BLOCK_TEXT_MAX_BYTES,
        });
    }
    let bytes = session.read_file(&base, &block.content_path)?;
    Ok(TextBlockContent {
        text: decode_text(&bytes)?,
        content_hash: sha256_hex(&bytes),
    })
}

fn check_text_size(text: &str) -> AuthoringResult<()> {
    if text.len() as u64 > BLOCK_TEXT_MAX_BYTES {
        Err(AuthoringError::TextTooLarge {
            limit_bytes: BLOCK_TEXT_MAX_BYTES,
        })
    } else {
        Ok(())
    }
}

fn block_dto(
    block_id: String,
    block_type: BlockType,
    geometry: BlockGeometry,
    content_path: String,
) -> BlockDto {
    BlockDto {
        block_id,
        block_type: block_type.as_str().to_owned(),
        position: PositionDto {
            x: Number::from(geometry.x),
            y: Number::from(geometry.y),
        },
        size: SizeDto {
            width: Number::from(geometry.width),
            height: Number::from(geometry.height),
        },
        content_path,
        caption: None,
        caption_position: None,
    }
}

/// Adds a text Block in front of the others: its content file first, then the Sheet. The
/// content file is removed again if the Sheet cannot be saved.
pub fn create_text_block(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet: &SheetDto,
    block_type: &str,
    text: &str,
    geometry: BlockGeometry,
) -> AuthoringResult<BlockDto> {
    let block_type = BlockType::parse(block_type)?;
    if !is_text_block_type(block_type) {
        return Err(DomainError::new(
            crate::domain::error::DomainErrorKind::UnsupportedBlockType,
            format!("{} cannot be created from text", block_type.as_str()),
        )
        .into());
    }
    check_text_size(text)?;
    // Checked before any file exists, so a bad geometry leaves nothing behind.
    Position::new(geometry.x, geometry.y)?;
    Size::new(geometry.width, geometry.height)?;
    let content_path = create_block_content(
        sessions,
        project_id,
        document_id,
        &sheet.sheet_id,
        block_type.as_str(),
        text,
    )?;
    let block = block_dto(
        generate_block_id().to_string(),
        block_type,
        geometry,
        content_path.clone(),
    );
    let mut extended = sheet.clone();
    extended.blocks.push(block.clone());
    let saved = extended
        .to_domain()
        .map_err(AuthoringError::from)
        .and_then(|_| save_sheet(sessions, project_id, document_id, &extended).map_err(Into::into));
    if let Err(error) = saved {
        let _ = delete_block_content(sessions, project_id, document_id, &content_path);
        return Err(error);
    }
    Ok(block)
}

/// Replaces a text Block's text if the file still has the hash the caller based the new
/// text on; otherwise `Conflict` and nothing is written.
pub fn update_text_block(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet: &SheetDto,
    block_id: &str,
    text: &str,
    expected_content_hash: &str,
) -> AuthoringResult<TextBlockWrite> {
    let block = find_block(sheet, block_id)?;
    require_text_block(block)?;
    check_text_size(text)?;
    let current = read_text_block(sessions, project_id, document_id, block)?;
    if current.content_hash != expected_content_hash {
        return Err(AuthoringError::Conflict);
    }
    let result = write_block_content(sessions, project_id, document_id, &block.content_path, text)?;
    Ok(TextBlockWrite {
        content_hash: sha256_hex(&encode_text(text)),
        written: result.written,
    })
}

/// Changes a Block's position and, when given, its size. The Block keeps its z-order.
pub fn move_block(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet: &SheetDto,
    block_id: &str,
    position: (i64, i64),
    size: Option<(i64, i64)>,
) -> AuthoringResult<BlockDto> {
    let target = find_block(sheet, block_id)?.block_id.clone();
    let mut moved = sheet.clone();
    let block = moved
        .blocks
        .iter_mut()
        .find(|block| block.block_id == target)
        .expect("find_block just found this block in the same sheet");
    block.position = PositionDto {
        x: Number::from(position.0),
        y: Number::from(position.1),
    };
    if let Some((width, height)) = size {
        block.size = SizeDto {
            width: Number::from(width),
            height: Number::from(height),
        };
    }
    moved.to_domain()?;
    save_sheet(sessions, project_id, document_id, &moved)?;
    Ok(moved
        .blocks
        .into_iter()
        .find(|block| block.block_id == target)
        .expect("the block was found above"))
}

/// Unlists a Block, then deletes its text file. An Image Block's asset stays: it may be used
/// by other Blocks (the app's delete does the same).
pub fn delete_block(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet: &SheetDto,
    block_id: &str,
) -> AuthoringResult<BlockRemoval> {
    let block = find_block(sheet, block_id)?.clone();
    let block_type = BlockType::parse(&block.block_type)?;
    let mut reduced = sheet.clone();
    reduced
        .blocks
        .retain(|candidate| candidate.block_id != block.block_id);
    save_sheet(sessions, project_id, document_id, &reduced)?;
    if !is_text_block_type(block_type) {
        return Ok(BlockRemoval {
            content_file_removed: false,
        });
    }
    let removed =
        delete_block_content(sessions, project_id, document_id, &block.content_path).is_ok();
    Ok(BlockRemoval {
        content_file_removed: removed,
    })
}

/// Natural size of an Image Block's file, or `None` when it cannot be determined (missing,
/// too large, not a valid image of the format its name says). Read-only and best effort: a
/// description of a Block must not fail because its picture is broken.
pub fn image_natural_size(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    block: &BlockDto,
) -> Option<(u32, u32)> {
    let format = ImageFormat::from_file_name(&block.content_path)?;
    let session = sessions.session_mut(project_id).ok()?;
    let document_id = DocumentId::parse(document_id).ok()?;
    let base = session.document_base(&document_id).ok()?;
    let path = session
        .resolve_existing_path(&base, &block.content_path)
        .ok()?;
    if fs::metadata(&path).ok()?.len() > ASSET_MAX_BYTES {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    validate_image_content(format, &bytes).ok()?;
    let size = natural_size(format, &bytes).ok()?;
    Some((size.width, size.height))
}
