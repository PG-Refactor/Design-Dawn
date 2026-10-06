//! Deep Folder hierarchies (file-format.md §3.5: Folders nest without a depth limit): every
//! operation must work at the bottom of a long chain. The chain's relative paths exceed the
//! classic Windows MAX_PATH; Linux does not enforce it, so these tests only document the
//! scenario. The real Windows behaviour must be verified on Windows (docs/testing.md).

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use design_dawn_lib::application::asset_import::{import_asset, read_asset_for_url};
use design_dawn_lib::application::block_content_operations::{
    create_block_content, read_block_content, write_block_content,
};
use design_dawn_lib::application::document_operations::{
    create_document, load_document, save_document,
};
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::folder_operations::{create_folder, move_entry, save_folder};
use design_dawn_lib::application::load_issue::LoadIssueKind;
use design_dawn_lib::application::project_operations::{
    create_project, open_entry_point, open_project, save_project, EntryPointResolution,
};
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::sheet_operations::{create_sheet, save_sheet};
use design_dawn_lib::application::snapshot::{EntityState, ProjectSnapshot};
use design_dawn_lib::domain::block_type::BlockType;
use design_dawn_lib::domain::error::DomainErrorKind;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::file_format::dto::{
    BlockDto, DocumentDto, FolderDto, PositionDto, ProjectDto, SheetDto, SizeDto,
};
use serde_json::Number;
use support::*;

/// Between 12 and 20 levels, as the scenario asks for.
const DEEP_CHAIN_DEPTH: usize = 16;
const BRANCH_CHAIN_DEPTH: usize = 8;
/// The classic Windows MAX_PATH. Only used to document that the fixture exceeds it.
const WINDOWS_MAX_PATH_LENGTH: usize = 260;
/// The slug of `Deep folder level NN`; long on purpose so the chain exceeds MAX_PATH.
const DEEP_FOLDER_NAME_PREFIX: &str = "Deep folder level";
const BRANCH_FOLDER_NAME_PREFIX: &str = "Branch";
const SIBLING_DOCUMENT_NAME: &str = "Sibling";
const DOCUMENT_NAME: &str = "Deep document";
const DOCUMENT_DIRECTORY: &str = "deep-document";
const SHEET_NAME: &str = "Deep sheet";
const SHEET_DIRECTORY: &str = "deep-sheet";
const MARKDOWN_TEXT: &str = "# Deep\n";
const ASSET_SOURCE_NAME: &str = "pixel.png";
const ASSET_PATH: &str = "assets/pixel.png";
const MID_LEVEL: usize = 5;
const ENTRY_POINT_FILE: &str = "deep.dawn";
const STALE_ENTRY_PATH: &str = "documents/no-such-folder/no-such-document";

const FOLDER_ID_BASE: u32 = 0x100;
const BRANCH_ID_BASE: u32 = 0x200;
const DOCUMENT_ID_NUMBER: u32 = 0x300;
const SIBLING_ID_NUMBER: u32 = 0x301;
const SHEET_ID_NUMBER: u32 = 0x400;
const BLOCK_ID_NUMBER: u32 = 0x500;

fn id(number: u32) -> String {
    format!("01928f3a-9000-7000-8000-{number:012x}")
}

fn deep_id(level: usize) -> String {
    id(FOLDER_ID_BASE + u32::try_from(level).unwrap())
}

fn branch_id(level: usize) -> String {
    id(BRANCH_ID_BASE + u32::try_from(level).unwrap())
}

fn deep_directory(level: usize) -> String {
    format!("deep-folder-level-{level:02}")
}

fn branch_directory(level: usize) -> String {
    format!("branch-{level:02}")
}

/// `documents/` relative path of the Folder at `level` of the deep chain.
fn deep_folder_path(level: usize) -> String {
    (0..=level)
        .map(deep_directory)
        .collect::<Vec<_>>()
        .join("/")
}

fn deep_document_path() -> String {
    format!(
        "{}/{DOCUMENT_DIRECTORY}",
        deep_folder_path(DEEP_CHAIN_DEPTH - 1)
    )
}

fn markdown_path() -> String {
    format!("sheets/{SHEET_DIRECTORY}/blocks/markdown-1.md")
}

struct DeepProject {
    temp: TempDir,
    root: PathBuf,
    project_id: String,
}

impl DeepProject {
    fn documents(&self) -> PathBuf {
        self.root.join("documents")
    }

    fn document_directory(&self) -> PathBuf {
        self.documents().join(deep_document_path())
    }
}

fn folder_dto(folder_id: &str, name: &str, child_order: Vec<String>) -> FolderDto {
    FolderDto {
        schema_version: Number::from(1),
        folder_id: folder_id.to_owned(),
        name: name.to_owned(),
        child_order,
    }
}

/// Creates `depth` nested Folders under `parent` and saves each one's `childOrder` so the
/// order is explicit. Returns nothing: IDs are derived from the level numbers.
fn build_chain(
    sessions: &mut ProjectSessions,
    project_id: &str,
    prefix: &str,
    id_of: fn(usize) -> String,
    depth: usize,
    leaf_child: Option<&str>,
) {
    let mut parent: Option<String> = None;
    for level in 0..depth {
        create_folder(
            sessions,
            project_id,
            parent.as_deref(),
            &id_of(level),
            &format!("{prefix} {level:02}"),
        )
        .unwrap();
        parent = Some(id_of(level));
    }
    for level in 0..depth {
        let child = if level + 1 < depth {
            Some(id_of(level + 1))
        } else {
            leaf_child.map(str::to_owned)
        };
        save_folder(
            sessions,
            project_id,
            &folder_dto(
                &id_of(level),
                &format!("{prefix} {level:02}"),
                child.into_iter().collect(),
            ),
        )
        .unwrap();
    }
}

fn block_dto(content_path: String) -> BlockDto {
    BlockDto {
        block_id: id(BLOCK_ID_NUMBER),
        block_type: BlockType::Markdown.as_str().to_owned(),
        position: PositionDto {
            x: Number::from(10),
            y: Number::from(20),
        },
        size: SizeDto {
            width: Number::from(300),
            height: Number::from(200),
        },
        content_path,
    }
}

fn sheet_dto(blocks: Vec<BlockDto>) -> SheetDto {
    SheetDto {
        schema_version: Number::from(1),
        sheet_id: id(SHEET_ID_NUMBER),
        name: SHEET_NAME.to_owned(),
        blocks,
    }
}

/// A Project with the deep chain, a Document + Sheet + Markdown Block + asset at its bottom,
/// a second shorter chain (`Branch`) and a sibling Document at the root. Written to disk,
/// then closed again so tests start from a fresh `open_project`.
fn build_deep_project() -> DeepProject {
    let temp = TempDir::new();
    let root = temp.path().join("project");
    let mut sessions = ProjectSessions::default();
    let snapshot = create_project(&mut sessions, &root, "Deep project").unwrap();
    let project_id = snapshot.project.project_id.clone();

    build_chain(
        &mut sessions,
        &project_id,
        DEEP_FOLDER_NAME_PREFIX,
        deep_id,
        DEEP_CHAIN_DEPTH,
        Some(&id(DOCUMENT_ID_NUMBER)),
    );
    build_chain(
        &mut sessions,
        &project_id,
        BRANCH_FOLDER_NAME_PREFIX,
        branch_id,
        BRANCH_CHAIN_DEPTH,
        None,
    );
    create_document(
        &mut sessions,
        &project_id,
        &id(DOCUMENT_ID_NUMBER),
        DOCUMENT_NAME,
        Some(&deep_id(DEEP_CHAIN_DEPTH - 1)),
    )
    .unwrap();
    create_document(
        &mut sessions,
        &project_id,
        &id(SIBLING_ID_NUMBER),
        SIBLING_DOCUMENT_NAME,
        None,
    )
    .unwrap();
    create_sheet(
        &mut sessions,
        &project_id,
        &id(DOCUMENT_ID_NUMBER),
        &id(SHEET_ID_NUMBER),
        SHEET_NAME,
    )
    .unwrap();
    save_document(
        &mut sessions,
        &project_id,
        &DocumentDto {
            schema_version: Number::from(1),
            document_id: id(DOCUMENT_ID_NUMBER),
            name: DOCUMENT_NAME.to_owned(),
            sheet_order: vec![id(SHEET_ID_NUMBER)],
        },
    )
    .unwrap();
    let content_path = create_block_content(
        &mut sessions,
        &project_id,
        &id(DOCUMENT_ID_NUMBER),
        &id(SHEET_ID_NUMBER),
        BlockType::Markdown.as_str(),
        MARKDOWN_TEXT,
    )
    .unwrap();
    assert_eq!(content_path, markdown_path());
    save_sheet(
        &mut sessions,
        &project_id,
        &id(DOCUMENT_ID_NUMBER),
        &sheet_dto(vec![block_dto(content_path)]),
    )
    .unwrap();
    let source = temp.path().join(ASSET_SOURCE_NAME);
    fs::write(&source, png_bytes(4, 4)).unwrap();
    let imported =
        import_asset(&mut sessions, &project_id, &id(DOCUMENT_ID_NUMBER), &source).unwrap();
    assert_eq!(imported.content_path, ASSET_PATH);
    save_project(
        &mut sessions,
        &project_id,
        &ProjectDto {
            schema_version: Number::from(2),
            project_id: project_id.clone(),
            name: "Deep project".to_owned(),
            child_order: vec![deep_id(0), branch_id(0), id(SIBLING_ID_NUMBER)],
        },
    )
    .unwrap();
    DeepProject {
        temp,
        root,
        project_id,
    }
}

struct Opened {
    deep: DeepProject,
    sessions: Mutex<ProjectSessions>,
    snapshot: ProjectSnapshot,
}

impl Opened {
    fn new() -> Self {
        let deep = build_deep_project();
        let mut sessions = ProjectSessions::default();
        let snapshot = open_project(&mut sessions, &deep.root).expect("open deep project");
        Self {
            deep,
            sessions: Mutex::new(sessions),
            snapshot,
        }
    }

    fn with<R>(&self, operation: impl FnOnce(&mut ProjectSessions) -> R) -> R {
        operation(&mut self.sessions.lock().unwrap())
    }

    fn load_document(&self) {
        self.with(|sessions| {
            load_document(sessions, &self.deep.project_id, &id(DOCUMENT_ID_NUMBER)).unwrap()
        });
    }

    fn read_markdown(
        &self,
    ) -> Result<String, design_dawn_lib::application::error::ApplicationError> {
        self.with(|sessions| {
            read_block_content(
                sessions,
                &self.deep.project_id,
                &id(DOCUMENT_ID_NUMBER),
                &markdown_path(),
            )
        })
    }

    fn write_markdown(&self, text: &str) {
        self.with(|sessions| {
            write_block_content(
                sessions,
                &self.deep.project_id,
                &id(DOCUMENT_ID_NUMBER),
                &markdown_path(),
                text,
            )
            .unwrap()
        });
    }

    fn read_asset(
        &self,
    ) -> Result<
        design_dawn_lib::application::asset_import::AssetContent,
        design_dawn_lib::application::error::ApplicationError,
    > {
        read_asset_for_url(
            &self.sessions,
            &self.deep.project_id,
            &id(DOCUMENT_ID_NUMBER),
            ASSET_PATH,
        )
    }

    fn move_to(&self, entry_id: &str, target: Option<&str>) {
        self.with(|sessions| {
            move_entry(sessions, &self.deep.project_id, entry_id, target).unwrap()
        });
    }
}

fn folder_parent<'a>(snapshot: &'a ProjectSnapshot, folder_id: &str) -> Option<&'a str> {
    snapshot
        .folders
        .iter()
        .find(|folder| folder.folder_id == folder_id)
        .unwrap_or_else(|| panic!("folder {folder_id} not found"))
        .parent_folder_id
        .as_deref()
}

#[test]
fn every_folder_and_the_document_are_discovered_with_the_parent_chain_and_orders() {
    let opened = Opened::new();
    let snapshot = &opened.snapshot;
    assert!(snapshot.issues.is_empty(), "{:?}", snapshot.issues);
    assert_eq!(
        snapshot.folders.len(),
        DEEP_CHAIN_DEPTH + BRANCH_CHAIN_DEPTH
    );
    assert!(snapshot
        .folders
        .iter()
        .all(|folder| folder.state == EntityState::Loaded));

    assert_eq!(folder_parent(snapshot, &deep_id(0)), None);
    for level in 1..DEEP_CHAIN_DEPTH {
        assert_eq!(
            folder_parent(snapshot, &deep_id(level)),
            Some(deep_id(level - 1).as_str()),
            "level {level}"
        );
    }
    for level in 1..BRANCH_CHAIN_DEPTH {
        assert_eq!(
            folder_parent(snapshot, &branch_id(level)),
            Some(branch_id(level - 1).as_str())
        );
    }
    for level in 0..DEEP_CHAIN_DEPTH - 1 {
        let entry = snapshot
            .folders
            .iter()
            .find(|folder| folder.folder_id == deep_id(level))
            .unwrap();
        assert_eq!(entry.child_order, vec![deep_id(level + 1)], "level {level}");
    }
    let deepest = snapshot
        .folders
        .iter()
        .find(|folder| folder.folder_id == deep_id(DEEP_CHAIN_DEPTH - 1))
        .unwrap();
    assert_eq!(deepest.child_order, vec![id(DOCUMENT_ID_NUMBER)]);

    let document = snapshot
        .documents
        .iter()
        .find(|document| document.document_id == id(DOCUMENT_ID_NUMBER))
        .expect("deep document discovered");
    assert_eq!(
        document.parent_folder_id.as_deref(),
        Some(deep_id(DEEP_CHAIN_DEPTH - 1).as_str())
    );
    assert_eq!(document.name.as_deref(), Some(DOCUMENT_NAME));
    assert_eq!(
        snapshot.project.child_order,
        vec![deep_id(0), branch_id(0), id(SIBLING_ID_NUMBER)]
    );
}

#[test]
fn the_deep_document_loads_and_its_block_content_round_trips() {
    let opened = Opened::new();
    let before = tree_snapshot(&opened.deep.root);
    let document = opened.with(|sessions| {
        load_document(sessions, &opened.deep.project_id, &id(DOCUMENT_ID_NUMBER)).unwrap()
    });
    assert_eq!(
        tree_snapshot(&opened.deep.root),
        before,
        "loading must not write"
    );
    assert!(document.issues.is_empty(), "{:?}", document.issues);
    assert_eq!(document.sheets.len(), 1);
    let sheet = document.sheets[0].sheet.as_ref().expect("sheet loaded");
    assert_eq!(sheet.blocks[0].content_path, markdown_path());

    assert_eq!(opened.read_markdown().unwrap(), MARKDOWN_TEXT);
    opened.write_markdown("# Edited deep\n");
    assert_eq!(opened.read_markdown().unwrap(), "# Edited deep\n");
    assert_eq!(
        read_text(&opened.deep.document_directory().join(markdown_path())),
        "# Edited deep\n"
    );

    // save_sheet at the bottom of the chain rewrites sheet.json in place.
    let mut edited = sheet.clone();
    edited.blocks[0].position.x = Number::from(99);
    let saved = opened.with(|sessions| {
        save_sheet(
            sessions,
            &opened.deep.project_id,
            &id(DOCUMENT_ID_NUMBER),
            &edited,
        )
        .unwrap()
    });
    assert!(saved.written);
    let sheet_json = read_json(
        &opened
            .deep
            .document_directory()
            .join(format!("sheets/{SHEET_DIRECTORY}/sheet.json")),
    );
    assert_eq!(sheet_json["blocks"][0]["position"]["x"], 99);
}

#[test]
fn an_asset_imports_into_the_deep_document_and_is_served_after_load() {
    let opened = Opened::new();
    // Only an opened Document is served.
    assert_eq!(
        opened.read_asset().unwrap_err().kind,
        ErrorKind::EntityNotFound,
        "an unopened document must not be served"
    );
    opened.load_document();
    let content = opened.read_asset().expect("asset served");
    assert_eq!(content.bytes, png_bytes(4, 4));

    let second_source = opened.deep.temp.path().join("second.png");
    fs::write(&second_source, png_bytes(8, 2)).unwrap();
    let imported = opened.with(|sessions| {
        import_asset(
            sessions,
            &opened.deep.project_id,
            &id(DOCUMENT_ID_NUMBER),
            &second_source,
        )
        .unwrap()
    });
    assert_eq!(imported.content_path, "assets/second.png");
    assert!(opened
        .deep
        .document_directory()
        .join("assets/second.png")
        .is_file());
}

#[test]
fn the_entry_point_at_the_project_root_opens_the_deep_document_by_path() {
    let deep = build_deep_project();
    let entry = deep.root.join(ENTRY_POINT_FILE);
    write_json(
        &entry,
        &serde_json::json!({
            "schemaVersion": 1,
            "documentId": id(DOCUMENT_ID_NUMBER),
            "path": format!("documents/{}", deep_document_path())
        }),
    );
    let mut sessions = ProjectSessions::default();
    let opened = open_entry_point(&mut sessions, &entry).unwrap();
    assert_eq!(opened.resolution, EntryPointResolution::Path);
    assert_eq!(opened.snapshot.document_id, id(DOCUMENT_ID_NUMBER));
    assert_eq!(
        opened.snapshot.snapshot.folders.len(),
        DEEP_CHAIN_DEPTH + BRANCH_CHAIN_DEPTH
    );
}

#[test]
fn a_stale_entry_point_path_falls_back_to_the_id_scan() {
    let deep = build_deep_project();
    let entry = deep.root.join(ENTRY_POINT_FILE);
    write_json(
        &entry,
        &serde_json::json!({
            "schemaVersion": 1,
            "documentId": id(DOCUMENT_ID_NUMBER),
            "path": STALE_ENTRY_PATH
        }),
    );
    let mut sessions = ProjectSessions::default();
    let opened = open_entry_point(&mut sessions, &entry).unwrap();
    assert_eq!(opened.resolution, EntryPointResolution::IdScan);
    assert_eq!(opened.snapshot.document_id, id(DOCUMENT_ID_NUMBER));
    // The scan found the document, so it can be loaded and read at its real location.
    let loaded = load_document(&mut sessions, &deep.project_id, &id(DOCUMENT_ID_NUMBER)).unwrap();
    assert!(loaded.issues.is_empty());
}

#[test]
fn entry_point_paths_that_break_the_path_rules_are_ignored_and_the_id_scan_is_used() {
    let deep = build_deep_project();
    let entry = deep.root.join(ENTRY_POINT_FILE);
    let real = format!("documents/{}", deep_document_path());
    for invalid in [
        // The real location, but with Windows separators, a parent segment, a drive letter,
        // a UNC-like prefix, a reserved device segment or a trailing dot / space.
        real.replace('/', "\\"),
        format!("documents/../{real}"),
        format!("C:/{real}"),
        format!("//server/{real}"),
        format!("{real}/"),
        format!("{real}."),
        format!("{real} "),
        format!("documents/CON/{}", deep_document_path()),
        format!("documents/{}/aux", deep_folder_path(DEEP_CHAIN_DEPTH - 1)),
    ] {
        write_json(
            &entry,
            &serde_json::json!({
                "schemaVersion": 1,
                "documentId": id(DOCUMENT_ID_NUMBER),
                "path": invalid
            }),
        );
        let mut sessions = ProjectSessions::default();
        let opened = open_entry_point(&mut sessions, &entry).unwrap();
        assert_eq!(
            opened.resolution,
            EntryPointResolution::IdScan,
            "{invalid:?}"
        );
        assert_eq!(opened.snapshot.document_id, id(DOCUMENT_ID_NUMBER));
    }
}

#[test]
fn moving_a_mid_level_folder_to_the_root_keeps_the_open_document_working() {
    let opened = Opened::new();
    opened.load_document();
    let mid_id = deep_id(MID_LEVEL);
    opened.move_to(&mid_id, None);

    let moved_root = opened.deep.documents().join(deep_directory(MID_LEVEL));
    assert!(moved_root.join("folder.json").is_file());
    assert!(!opened
        .deep
        .documents()
        .join(deep_folder_path(MID_LEVEL))
        .exists());
    let relocated_document = moved_root.join(
        (MID_LEVEL + 1..DEEP_CHAIN_DEPTH)
            .map(deep_directory)
            .chain(std::iter::once(DOCUMENT_DIRECTORY.to_owned()))
            .collect::<Vec<_>>()
            .join("/"),
    );

    // Paths were rebased: the already open document reads and writes at the new location.
    assert_eq!(opened.read_markdown().unwrap(), MARKDOWN_TEXT);
    opened.write_markdown("# After move\n");
    assert_eq!(
        read_text(&relocated_document.join(markdown_path())),
        "# After move\n"
    );
    assert_eq!(opened.read_asset().unwrap().bytes, png_bytes(4, 4));

    let reopened = open_project(&mut ProjectSessions::default(), &opened.deep.root).unwrap();
    assert_eq!(folder_parent(&reopened, &mid_id), None);
    assert_eq!(
        folder_parent(&reopened, &deep_id(MID_LEVEL + 1)),
        Some(mid_id.as_str())
    );
    assert!(reopened
        .documents
        .iter()
        .any(|document| document.document_id == id(DOCUMENT_ID_NUMBER)
            && document.parent_folder_id.as_deref()
                == Some(deep_id(DEEP_CHAIN_DEPTH - 1).as_str())));
}

#[test]
fn moving_a_mid_level_folder_into_another_deep_folder_keeps_everything_working() {
    let opened = Opened::new();
    opened.load_document();
    let mid_id = deep_id(MID_LEVEL);
    let target_id = branch_id(BRANCH_CHAIN_DEPTH - 1);
    opened.move_to(&mid_id, Some(&target_id));

    let target_path = (0..BRANCH_CHAIN_DEPTH)
        .map(branch_directory)
        .collect::<Vec<_>>()
        .join("/");
    let moved = opened
        .deep
        .documents()
        .join(&target_path)
        .join(deep_directory(MID_LEVEL));
    assert!(moved.join("folder.json").is_file());

    assert_eq!(opened.read_markdown().unwrap(), MARKDOWN_TEXT);
    opened.write_markdown("# Branch move\n");
    assert_eq!(opened.read_markdown().unwrap(), "# Branch move\n");
    assert_eq!(opened.read_asset().unwrap().bytes, png_bytes(4, 4));

    let reopened = open_project(&mut ProjectSessions::default(), &opened.deep.root).unwrap();
    assert_eq!(folder_parent(&reopened, &mid_id), Some(target_id.as_str()));
    // move_entry leaves both parents' order arrays alone (documented), so the only issues
    // are the stale listing in the old parent and the unlisted entry in the new one.
    let mut kinds: Vec<_> = reopened.issues.iter().map(|issue| issue.kind).collect();
    kinds.sort_by_key(|kind| format!("{kind:?}"));
    assert_eq!(
        kinds,
        vec![LoadIssueKind::MissingEntity, LoadIssueKind::UnlistedEntity]
    );
}

#[test]
fn a_content_path_with_parent_segments_is_rejected_at_the_bottom_of_the_chain() {
    let opened = Opened::new();
    opened.load_document();
    for traversal in [
        "sheets/deep-sheet/blocks/../../../document.json",
        "../document.json",
        "sheets/deep-sheet/blocks/./markdown-1.md",
        "sheets\\deep-sheet\\blocks\\markdown-1.md",
    ] {
        let error = opened
            .with(|sessions| {
                read_block_content(
                    sessions,
                    &opened.deep.project_id,
                    &id(DOCUMENT_ID_NUMBER),
                    traversal,
                )
            })
            .unwrap_err();
        assert!(
            matches!(
                error.kind,
                ErrorKind::Domain(DomainErrorKind::InvalidContentPath)
            ),
            "{traversal}: {:?}",
            error.kind
        );
    }
}

#[cfg(unix)]
mod symlink_escapes {
    use super::*;
    use std::os::unix::fs::symlink;

    fn outside_copy(opened: &Opened, source: &Path) -> PathBuf {
        let outside = opened.deep.temp.path().join("outside");
        fs::rename(source, &outside).unwrap();
        outside
    }

    #[test]
    fn a_symlinked_folder_inside_the_chain_is_never_followed() {
        let opened = Opened::new();
        opened.load_document();
        let link_location = opened.deep.documents().join(deep_folder_path(MID_LEVEL));
        let outside = outside_copy(&opened, &link_location);
        symlink(&outside, &link_location).unwrap();

        for error in [
            opened.read_markdown().unwrap_err(),
            opened.read_asset().unwrap_err(),
        ] {
            assert_eq!(
                error.kind,
                ErrorKind::Persistence(PersistenceErrorKind::PathOutsideRoot)
            );
        }
        let write = opened.with(|sessions| {
            write_block_content(
                sessions,
                &opened.deep.project_id,
                &id(DOCUMENT_ID_NUMBER),
                &markdown_path(),
                "# escaped\n",
            )
        });
        assert_eq!(
            write.unwrap_err().kind,
            ErrorKind::Persistence(PersistenceErrorKind::PathOutsideRoot)
        );
        // The real files outside are untouched.
        let outside_markdown = outside
            .join(
                (MID_LEVEL + 1..DEEP_CHAIN_DEPTH)
                    .map(deep_directory)
                    .chain(std::iter::once(DOCUMENT_DIRECTORY.to_owned()))
                    .collect::<Vec<_>>()
                    .join("/"),
            )
            .join(markdown_path());
        assert_eq!(read_text(&outside_markdown), MARKDOWN_TEXT);
    }

    #[test]
    fn a_symlinked_blocks_directory_of_the_deep_sheet_is_never_followed() {
        let opened = Opened::new();
        opened.load_document();
        let blocks = opened
            .deep
            .document_directory()
            .join(format!("sheets/{SHEET_DIRECTORY}/blocks"));
        let outside = outside_copy(&opened, &blocks);
        symlink(&outside, &blocks).unwrap();
        assert_eq!(
            opened.read_markdown().unwrap_err().kind,
            ErrorKind::Persistence(PersistenceErrorKind::PathOutsideRoot)
        );
    }
}

#[test]
fn the_deepest_file_exceeds_the_classic_windows_max_path_length() {
    // Documents the scenario for Windows verification; nothing is asserted to fail here.
    // Linux does not enforce MAX_PATH, so this only checks the fixture is deep enough.
    let deep = build_deep_project();
    let deepest = deep.document_directory().join(markdown_path());
    let relative = deepest.strip_prefix(&deep.root).unwrap();
    let relative_length = relative.to_string_lossy().len();
    assert!(
        relative_length > WINDOWS_MAX_PATH_LENGTH,
        "relative path is only {relative_length} characters"
    );
    assert!(deepest.is_file());
}
