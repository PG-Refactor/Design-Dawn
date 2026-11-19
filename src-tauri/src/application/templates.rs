//! Custom templates: Markdown and Mermaid blocks, sheets and Documents a person saved to
//! start new ones from. Three places hold them:
//!
//! - shared: `templates/` in the Project folder, so Git shares them with everyone;
//! - this Project only, for this person: the app's local data, by Project id;
//! - every Project, for this person: the app's local data.
//!
//! A template is a folder a person can read and edit: `template.json` (its name and the
//! layout of its blocks) next to the block texts as `.md` / `.mmd` files and the images in
//! `assets/`, the same split as a Document's own files. The Frontend names a template only
//! by its place, kind and id; paths never cross the IPC boundary.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::infrastructure::error::PersistenceError;
use crate::infrastructure::file_format::naming::unique_directory_name;
use crate::infrastructure::filesystem::atomic_write::write_atomic;
use crate::infrastructure::filesystem::directory::{list_directory, EntryKind};

pub const TEMPLATES_DIRECTORY_NAME: &str = "templates";
pub const TEMPLATE_FILE_NAME: &str = "template.json";
pub const TEMPLATE_ASSETS_DIRECTORY: &str = "assets";
const CURRENT_TEMPLATE_SCHEMA_VERSION: u32 = 1;
/// The folder name of a template whose name gives no usable slug.
const FALLBACK_DIRECTORY_BASE: &str = "template";
/// The text file of a block template.
const BLOCK_CONTENT_STEM: &str = "content";
/// Where a sheet template keeps its block texts; a Document template has one per sheet.
const SHEET_BLOCKS_DIRECTORY: &str = "blocks";
const DOCUMENT_SHEETS_DIRECTORY: &str = "sheets";
const MARKDOWN_EXTENSION: &str = "md";
const MERMAID_EXTENSION: &str = "mmd";
const BLOCK_TYPE_MARKDOWN: &str = "markdown";
const BLOCK_TYPE_MERMAID: &str = "mermaid";
const BLOCK_TYPE_IMAGE: &str = "image";
const STAGING_PREFIX: &str = ".staging-";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TemplateScope {
    Shared,
    Project,
    Global,
}

impl TemplateScope {
    pub fn parse(value: &str) -> ApplicationResult<Self> {
        match value {
            "shared" => Ok(Self::Shared),
            "project" => Ok(Self::Project),
            "global" => Ok(Self::Global),
            other => Err(invalid(format!("unknown template place: {other:?}"))),
        }
    }

    pub const ALL: [Self; 3] = [Self::Shared, Self::Project, Self::Global];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TemplateKind {
    Markdown,
    Mermaid,
    Sheet,
    Document,
}

impl TemplateKind {
    pub fn parse(value: &str) -> ApplicationResult<Self> {
        match value {
            "markdown" => Ok(Self::Markdown),
            "mermaid" => Ok(Self::Mermaid),
            "sheet" => Ok(Self::Sheet),
            "document" => Ok(Self::Document),
            other => Err(invalid(format!("unknown template kind: {other:?}"))),
        }
    }

    /// Also the folder that holds the templates of this kind.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Mermaid => "mermaid",
            Self::Sheet => "sheet",
            Self::Document => "document",
        }
    }

    pub const ALL: [Self; 4] = [Self::Markdown, Self::Mermaid, Self::Sheet, Self::Document];
}

fn invalid(detail: impl Into<String>) -> ApplicationError {
    ApplicationError::new(ErrorKind::InvalidTemplate, detail)
}

fn not_found(detail: impl Into<String>) -> ApplicationError {
    ApplicationError::new(ErrorKind::EntityNotFound, detail)
}

fn io_error(context: String) -> impl FnOnce(std::io::Error) -> ApplicationError {
    move |error| PersistenceError::from_io(context, &error).into()
}

/// The three folders, resolved by the caller (the Project folder, the app's local data).
/// `shared` is `None` without an open Project.
#[derive(Debug, Clone)]
pub struct TemplateRoots {
    pub shared: Option<PathBuf>,
    pub project: Option<PathBuf>,
    pub global: PathBuf,
}

impl TemplateRoots {
    fn root(&self, scope: TemplateScope) -> ApplicationResult<&Path> {
        match scope {
            TemplateScope::Shared => self.shared.as_deref(),
            TemplateScope::Project => self.project.as_deref(),
            TemplateScope::Global => Some(self.global.as_path()),
        }
        .ok_or_else(|| not_found("no Project is open for this template place"))
    }

    fn kind_directory(
        &self,
        scope: TemplateScope,
        kind: TemplateKind,
    ) -> ApplicationResult<PathBuf> {
        Ok(self.root(scope)?.join(kind.as_str()))
    }
}

// ---- the files ----

/// One block of a template as `template.json` stores it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateBlockFile {
    pub block_type: String,
    #[serde(default)]
    pub x: i64,
    #[serde(default)]
    pub y: i64,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption_position: Option<String>,
    /// The text file (`.md` / `.mmd`) or the image under `assets/`, relative to the
    /// template folder.
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSheetFile {
    pub sheet_name: String,
    pub blocks: Vec<TemplateBlockFile>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateFile {
    schema_version: u32,
    template_id: String,
    kind: String,
    name: String,
    /// A Markdown or Mermaid template.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    block: Option<TemplateBlockFile>,
    /// One for a sheet template, every sheet for a Document template.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    sheets: Vec<TemplateSheetFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    document_name: Option<String>,
}

// ---- what the Frontend sends and gets ----

/// A block on the wire: its text, or for an image the asset (on save, the Document's
/// contentPath of the image; on read, the file name in the template's `assets/`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateBlockContent {
    pub block_type: String,
    #[serde(default)]
    pub x: i64,
    #[serde(default)]
    pub y: i64,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption_position: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSheetContent {
    pub sheet_name: String,
    pub blocks: Vec<TemplateBlockContent>,
}

/// What a template holds, read for creating from it; and what is saved as a new one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateContent {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block: Option<TemplateBlockContent>,
    #[serde(default)]
    pub sheets: Vec<TemplateSheetContent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_name: Option<String>,
    /// Images the texts show (Markdown image references). On save: the Document's
    /// contentPaths to copy; on read: the file names in the template's `assets/`.
    #[serde(default)]
    pub assets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummary {
    pub scope: TemplateScope,
    pub kind: TemplateKind,
    pub template_id: String,
    pub name: String,
}

/// What a template folder could not be read for; the list goes on without it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateLoadIssue {
    pub scope: TemplateScope,
    pub kind: TemplateKind,
    pub folder: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TemplateList {
    pub templates: Vec<TemplateSummary>,
    pub issues: Vec<TemplateLoadIssue>,
}

// ---- reading ----

fn read_template_file(folder: &Path) -> ApplicationResult<TemplateFile> {
    let path = folder.join(TEMPLATE_FILE_NAME);
    let text = fs::read_to_string(&path).map_err(io_error(format!("read {}", path.display())))?;
    let file: TemplateFile = serde_json::from_str(&text)
        .map_err(|error| invalid(format!("{TEMPLATE_FILE_NAME}: {error}")))?;
    if file.schema_version != CURRENT_TEMPLATE_SCHEMA_VERSION {
        return Err(invalid(format!(
            "schemaVersion {} is not {CURRENT_TEMPLATE_SCHEMA_VERSION}",
            file.schema_version
        )));
    }
    Uuid::parse_str(&file.template_id).map_err(|error| invalid(format!("templateId: {error}")))?;
    Ok(file)
}

/// The real folders directly in `directory` (no symbolic links: a template is a plain
/// folder, and a link could lead out of the template places).
fn template_folders(directory: &Path) -> ApplicationResult<Vec<(String, PathBuf)>> {
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    Ok(list_directory(directory)?
        .into_iter()
        .filter(|entry| {
            entry.kind == EntryKind::Directory
                && !entry.is_symlink
                && entry.is_utf8_name
                && !entry.name.starts_with(STAGING_PREFIX)
        })
        .map(|entry| {
            let path = directory.join(&entry.name);
            (entry.name, path)
        })
        .collect())
}

pub fn list_templates(roots: &TemplateRoots) -> TemplateList {
    let mut list = TemplateList::default();
    for scope in TemplateScope::ALL {
        let Ok(root) = roots.root(scope) else {
            continue;
        };
        for kind in TemplateKind::ALL {
            let folders = match template_folders(&root.join(kind.as_str())) {
                Ok(folders) => folders,
                Err(error) => {
                    list.issues.push(TemplateLoadIssue {
                        scope,
                        kind,
                        folder: kind.as_str().to_owned(),
                        detail: error.detail,
                    });
                    continue;
                }
            };
            for (folder_name, folder) in folders {
                match read_template_file(&folder) {
                    Ok(file) if file.kind == kind.as_str() => {
                        list.templates.push(TemplateSummary {
                            scope,
                            kind,
                            template_id: file.template_id,
                            name: file.name,
                        })
                    }
                    Ok(file) => list.issues.push(TemplateLoadIssue {
                        scope,
                        kind,
                        folder: folder_name,
                        detail: format!("kind {:?} in the {} folder", file.kind, kind.as_str()),
                    }),
                    Err(error) => list.issues.push(TemplateLoadIssue {
                        scope,
                        kind,
                        folder: folder_name,
                        detail: error.detail,
                    }),
                }
            }
        }
    }
    list.templates
        .sort_by_key(|template| template.name.to_lowercase());
    list
}

/// The folder of the template with `template_id` (found by reading, never by a path given).
fn find_template(
    roots: &TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: &str,
) -> ApplicationResult<(PathBuf, TemplateFile)> {
    let directory = roots.kind_directory(scope, kind)?;
    for (_, folder) in template_folders(&directory)? {
        if let Ok(file) = read_template_file(&folder) {
            if file.template_id == template_id {
                return Ok((folder, file));
            }
        }
    }
    Err(not_found(format!("template {template_id} not found")))
}

/// A file named by `template.json`, which must stay inside the template folder.
fn inside(folder: &Path, relative: &str) -> ApplicationResult<PathBuf> {
    let path = Path::new(relative);
    let plain = path
        .components()
        .all(|component| matches!(component, std::path::Component::Normal(_)));
    if relative.is_empty() || !plain {
        return Err(invalid(format!(
            "file {relative:?} is not inside the template"
        )));
    }
    let resolved = folder.join(path);
    let real_folder = folder
        .canonicalize()
        .map_err(io_error(format!("resolve {}", folder.display())))?;
    let real = resolved
        .canonicalize()
        .map_err(io_error(format!("resolve {}", resolved.display())))?;
    if !real.starts_with(&real_folder) {
        return Err(invalid(format!(
            "file {relative:?} leads out of the template"
        )));
    }
    Ok(real)
}

fn asset_name_of(file: &str) -> Option<String> {
    file.strip_prefix(TEMPLATE_ASSETS_DIRECTORY)
        .and_then(|rest| rest.strip_prefix('/'))
        .filter(|name| !name.is_empty() && !name.contains('/'))
        .map(str::to_owned)
}

fn read_block(folder: &Path, block: &TemplateBlockFile) -> ApplicationResult<TemplateBlockContent> {
    let mut content = TemplateBlockContent {
        block_type: block.block_type.clone(),
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        caption: block.caption.clone(),
        caption_position: block.caption_position.clone(),
        text: None,
        asset: None,
    };
    if block.block_type == BLOCK_TYPE_IMAGE {
        let name = asset_name_of(&block.file)
            .ok_or_else(|| invalid(format!("image {:?} is not in assets/", block.file)))?;
        inside(folder, &block.file)?;
        content.asset = Some(name);
    } else {
        let path = inside(folder, &block.file)?;
        content.text =
            Some(fs::read_to_string(&path).map_err(io_error(format!("read {}", block.file)))?);
    }
    Ok(content)
}

pub fn read_template(
    roots: &TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: &str,
) -> ApplicationResult<TemplateContent> {
    let (folder, file) = find_template(roots, scope, kind, template_id)?;
    let block = file
        .block
        .as_ref()
        .map(|block| read_block(&folder, block))
        .transpose()?;
    let sheets = file
        .sheets
        .iter()
        .map(|sheet| {
            Ok(TemplateSheetContent {
                sheet_name: sheet.sheet_name.clone(),
                blocks: sheet
                    .blocks
                    .iter()
                    .map(|block| read_block(&folder, block))
                    .collect::<ApplicationResult<_>>()?,
            })
        })
        .collect::<ApplicationResult<Vec<_>>>()?;
    let assets_folder = folder.join(TEMPLATE_ASSETS_DIRECTORY);
    let assets = if assets_folder.is_dir() {
        list_directory(&assets_folder)?
            .into_iter()
            .filter(|entry| {
                entry.kind == EntryKind::File && !entry.is_symlink && entry.is_utf8_name
            })
            .map(|entry| entry.name)
            .collect()
    } else {
        Vec::new()
    };
    Ok(TemplateContent {
        name: file.name,
        block,
        sheets,
        document_name: file.document_name,
        assets,
    })
}

/// The image `asset_name` of a template, for importing it into a Document.
pub fn template_asset_path(
    roots: &TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: &str,
    asset_name: &str,
) -> ApplicationResult<PathBuf> {
    let (folder, _) = find_template(roots, scope, kind, template_id)?;
    if asset_name.contains(['/', '\\']) {
        return Err(invalid(format!("asset {asset_name:?} is not a file name")));
    }
    inside(
        &folder,
        &format!("{TEMPLATE_ASSETS_DIRECTORY}/{asset_name}"),
    )
}

// ---- writing ----

/// Reads one image of the Document (validated like an import) as `(file name, bytes)`.
pub type AssetReader<'a> = dyn Fn(&str) -> ApplicationResult<(String, Vec<u8>)> + 'a;

fn text_extension(block_type: &str) -> ApplicationResult<&'static str> {
    match block_type {
        BLOCK_TYPE_MARKDOWN => Ok(MARKDOWN_EXTENSION),
        BLOCK_TYPE_MERMAID => Ok(MERMAID_EXTENSION),
        other => Err(invalid(format!("block type {other:?} has no text"))),
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> ApplicationResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(io_error(format!("create {}", parent.display())))?;
    }
    write_atomic(path, bytes)?;
    Ok(())
}

/// Writes one block's file into the staging folder and returns its `template.json` entry.
fn stage_block(
    staging: &Path,
    text_directory: &str,
    number: usize,
    block: &TemplateBlockContent,
    read_asset: &AssetReader<'_>,
) -> ApplicationResult<TemplateBlockFile> {
    let file = if block.block_type == BLOCK_TYPE_IMAGE {
        let source = block
            .asset
            .as_deref()
            .ok_or_else(|| invalid("an image block without its asset"))?;
        let (name, bytes) = read_asset(source)?;
        let relative = format!("{TEMPLATE_ASSETS_DIRECTORY}/{name}");
        write_file(&staging.join(&relative), &bytes)?;
        relative
    } else {
        let extension = text_extension(&block.block_type)?;
        let text = block.text.as_deref().unwrap_or_default();
        let relative = if text_directory.is_empty() {
            format!("{BLOCK_CONTENT_STEM}.{extension}")
        } else {
            format!("{text_directory}/{number}.{extension}")
        };
        write_file(&staging.join(&relative), text.as_bytes())?;
        relative
    };
    Ok(TemplateBlockFile {
        block_type: block.block_type.clone(),
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        caption: block.caption.clone(),
        caption_position: block.caption_position.clone(),
        file,
    })
}

fn stage_sheet(
    staging: &Path,
    text_directory: &str,
    sheet: &TemplateSheetContent,
    read_asset: &AssetReader<'_>,
) -> ApplicationResult<TemplateSheetFile> {
    Ok(TemplateSheetFile {
        sheet_name: sheet.sheet_name.clone(),
        blocks: sheet
            .blocks
            .iter()
            .enumerate()
            .map(|(index, block)| {
                stage_block(staging, text_directory, index + 1, block, read_asset)
            })
            .collect::<ApplicationResult<_>>()?,
    })
}

fn existing_names(directory: &Path) -> ApplicationResult<Vec<String>> {
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    Ok(list_directory(directory)?
        .into_iter()
        .map(|entry| entry.name)
        .collect())
}

/// Moves a fully written staging folder to its place under a free name: a template appears
/// whole or not at all.
fn publish(staging: &Path, directory: &Path, name: &str) -> ApplicationResult<PathBuf> {
    let folder_name =
        unique_directory_name(name, FALLBACK_DIRECTORY_BASE, &existing_names(directory)?);
    let target = directory.join(folder_name);
    fs::rename(staging, &target).map_err(io_error(format!("place {}", target.display())))?;
    Ok(target)
}

fn new_staging(directory: &Path) -> ApplicationResult<PathBuf> {
    fs::create_dir_all(directory).map_err(io_error(format!("create {}", directory.display())))?;
    let staging = directory.join(format!("{STAGING_PREFIX}{}", Uuid::now_v7()));
    fs::create_dir(&staging).map_err(io_error(format!("create {}", staging.display())))?;
    Ok(staging)
}

fn checked_name(name: &str) -> ApplicationResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(invalid("a template needs a name"));
    }
    Ok(trimmed.to_owned())
}

/// Writes everything of `content` into `staging` and returns its `template.json` entry.
fn stage_content(
    staging: &Path,
    kind: TemplateKind,
    template_id: String,
    name: &str,
    content: &TemplateContent,
    read_asset: &AssetReader<'_>,
) -> ApplicationResult<TemplateFile> {
    let mut file = TemplateFile {
        schema_version: CURRENT_TEMPLATE_SCHEMA_VERSION,
        template_id,
        kind: kind.as_str().to_owned(),
        name: name.to_owned(),
        block: None,
        sheets: Vec::new(),
        document_name: None,
    };
    match kind {
        TemplateKind::Markdown | TemplateKind::Mermaid => {
            let block = content
                .block
                .as_ref()
                .ok_or_else(|| invalid("a block template needs its block"))?;
            if block.block_type != kind.as_str() {
                return Err(invalid(format!(
                    "a {} template cannot hold a {} block",
                    kind.as_str(),
                    block.block_type
                )));
            }
            file.block = Some(stage_block(staging, "", 0, block, read_asset)?);
        }
        TemplateKind::Sheet => {
            let [sheet] = content.sheets.as_slice() else {
                return Err(invalid("a sheet template holds exactly one sheet"));
            };
            file.sheets = vec![stage_sheet(
                staging,
                SHEET_BLOCKS_DIRECTORY,
                sheet,
                read_asset,
            )?];
        }
        TemplateKind::Document => {
            if content.sheets.is_empty() {
                return Err(invalid("a Document template needs a sheet"));
            }
            file.document_name = Some(
                content
                    .document_name
                    .clone()
                    .unwrap_or_else(|| name.to_owned()),
            );
            file.sheets = content
                .sheets
                .iter()
                .enumerate()
                .map(|(index, sheet)| {
                    stage_sheet(
                        staging,
                        &format!("{DOCUMENT_SHEETS_DIRECTORY}/{}", index + 1),
                        sheet,
                        read_asset,
                    )
                })
                .collect::<ApplicationResult<_>>()?;
        }
    }
    for source in &content.assets {
        let (asset_name, bytes) = read_asset(source)?;
        write_file(
            &staging.join(TEMPLATE_ASSETS_DIRECTORY).join(asset_name),
            &bytes,
        )?;
    }
    write_file(
        &staging.join(TEMPLATE_FILE_NAME),
        &serde_json::to_vec_pretty(&file)
            .map_err(|error| invalid(format!("{TEMPLATE_FILE_NAME}: {error}")))?,
    )?;
    Ok(file)
}

/// Saves `content` as a new template of `kind` in `scope`; returns its summary.
pub fn save_template(
    roots: &TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    content: &TemplateContent,
    read_asset: &AssetReader<'_>,
) -> ApplicationResult<TemplateSummary> {
    let name = checked_name(&content.name)?;
    let directory = roots.kind_directory(scope, kind)?;
    let staging = new_staging(&directory)?;
    let written = stage_content(
        &staging,
        kind,
        Uuid::now_v7().to_string(),
        &name,
        content,
        read_asset,
    );
    let file = match written {
        Ok(file) => file,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    if let Err(error) = publish(&staging, &directory, &name) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(TemplateSummary {
        scope,
        kind,
        template_id: file.template_id,
        name,
    })
}

/// Rewrites a template with new content, keeping its id, name and folder: the new folder is
/// written whole first, then takes the old one's place (the old one is kept until then, and
/// put back if the swap fails).
pub fn replace_template(
    roots: &TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: &str,
    content: &TemplateContent,
    read_asset: &AssetReader<'_>,
) -> ApplicationResult<()> {
    let (folder, file) = find_template(roots, scope, kind, template_id)?;
    let directory = roots.kind_directory(scope, kind)?;
    let staging = new_staging(&directory)?;
    if let Err(error) = stage_content(
        &staging,
        kind,
        file.template_id.clone(),
        &file.name,
        content,
        read_asset,
    ) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let backup = directory.join(format!("{STAGING_PREFIX}{}", Uuid::now_v7()));
    if let Err(error) = fs::rename(&folder, &backup) {
        let _ = fs::remove_dir_all(&staging);
        return Err(io_error(format!("set aside {}", folder.display()))(error));
    }
    if let Err(error) = fs::rename(&staging, &folder) {
        let _ = fs::rename(&backup, &folder);
        let _ = fs::remove_dir_all(&staging);
        return Err(io_error(format!("place {}", folder.display()))(error));
    }
    // The old copy is no longer needed; a leftover is skipped by every listing.
    let _ = fs::remove_dir_all(&backup);
    Ok(())
}

pub fn rename_template(
    roots: &TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: &str,
    name: &str,
) -> ApplicationResult<()> {
    let name = checked_name(name)?;
    let (folder, mut file) = find_template(roots, scope, kind, template_id)?;
    file.name = name;
    write_file(
        &folder.join(TEMPLATE_FILE_NAME),
        &serde_json::to_vec_pretty(&file)
            .map_err(|error| invalid(format!("{TEMPLATE_FILE_NAME}: {error}")))?,
    )
}

/// Removes the kind's folder, then the place's, when the last template left them empty
/// (an empty `templates/markdown/` left in the Project would only puzzle). Anything still
/// in them, or a failure to remove, leaves them as they are.
fn remove_emptied_folders(roots: &TemplateRoots, scope: TemplateScope, kind: TemplateKind) {
    let Ok(root) = roots.root(scope) else {
        return;
    };
    // `remove_dir` removes only an empty directory.
    let _ = fs::remove_dir(root.join(kind.as_str()));
    let _ = fs::remove_dir(root);
}

pub fn delete_template(
    roots: &TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: &str,
) -> ApplicationResult<()> {
    let (folder, _) = find_template(roots, scope, kind, template_id)?;
    fs::remove_dir_all(&folder).map_err(io_error(format!("remove {}", folder.display())))?;
    remove_emptied_folders(roots, scope, kind);
    Ok(())
}

fn copy_folder(from: &Path, to: &Path) -> ApplicationResult<()> {
    fs::create_dir_all(to).map_err(io_error(format!("create {}", to.display())))?;
    for entry in list_directory(from)? {
        if entry.is_symlink {
            continue;
        }
        let source = from.join(&entry.name);
        let target = to.join(&entry.name);
        match entry.kind {
            EntryKind::Directory => copy_folder(&source, &target)?,
            EntryKind::File => {
                fs::copy(&source, &target)
                    .map_err(io_error(format!("copy {}", source.display())))?;
            }
            EntryKind::Other => {}
        }
    }
    Ok(())
}

/// Moves a template to another place (keeping its id): copied whole first, removed after.
pub fn move_template(
    roots: &TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: &str,
    to: TemplateScope,
) -> ApplicationResult<()> {
    if scope == to {
        return Ok(());
    }
    let (folder, file) = find_template(roots, scope, kind, template_id)?;
    let directory = roots.kind_directory(to, kind)?;
    let staging = new_staging(&directory)?;
    if let Err(error) = copy_folder(&folder, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if let Err(error) = publish(&staging, &directory, &file.name) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    fs::remove_dir_all(&folder).map_err(io_error(format!("remove {}", folder.display())))?;
    remove_emptied_folders(roots, scope, kind);
    Ok(())
}
