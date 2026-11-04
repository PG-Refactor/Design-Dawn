//! Which Projects an AI client may use through `design-dawn-mcp`, kept in `ai-access.json`
//! in the app's config directory. The user adds Projects to the list (the one open in the
//! app, or a folder) and decides per Project whether an AI may change it; the app also
//! records which Project was used last, which an AI works on by default when it is listed.
//! Only the app writes the file, so an AI can never offer itself a Project or grant itself
//! write access: the MCP server only reads it.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Number;

use super::constants::{MAX_AI_ACCESS_PROJECTS, MCP_SERVER_EXECUTABLE_STEM};
use super::operations::check_schema_version;
use crate::application::error::{ApplicationError, ApplicationResult};
use crate::application::project_operations::read_project_identity;
use crate::domain::entity_id::ProjectId;
use crate::infrastructure::local_state::constants::{
    AI_ACCESS_FILE_NAME, CURRENT_AI_ACCESS_SCHEMA_VERSION,
};
use crate::infrastructure::local_state::dto::{AiAccessFileDto, AiAccessProjectDto};
use crate::infrastructure::local_state::files::{read_json_file, write_json_file};

const VERBATIM_UNC_PREFIX: &str = r"\\?\UNC\";
const VERBATIM_PREFIX: &str = r"\\?\";
const UNC_PREFIX: &str = r"\\";

/// The path as a person writes it. On Windows a resolved (canonical) path is in the
/// "verbatim" form `\\?\C:\work\x` (or `\\?\UNC\server\share\x`); the prefix is dropped
/// for showing and keeping the path. The path still opens the same folder (Rust adds the
/// prefix itself when a path is too long for the plain form).
pub fn plain_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(VERBATIM_UNC_PREFIX) {
        return PathBuf::from(format!("{UNC_PREFIX}{rest}"));
    }
    match text.strip_prefix(VERBATIM_PREFIX) {
        Some(rest) => PathBuf::from(rest),
        None => path.to_path_buf(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiProjectEntry {
    pub project_id: ProjectId,
    /// The Project folder (the one holding `project.json`).
    pub folder: PathBuf,
    pub allow_write: bool,
    /// The write access was given "this time only": it ends when the app exits.
    pub until_app_exits: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AiAccessList {
    /// The Project of the app window used last, listed or not.
    pub current_project_id: Option<ProjectId>,
    /// The Projects offered to AI, the one added last first.
    pub projects: Vec<AiProjectEntry>,
}

impl AiAccessList {
    /// An empty list when the file does not exist yet. `Err` means the file is unusable;
    /// the caller decides whether that is a problem to show or a list to start over.
    pub fn read(config_dir: &Path) -> ApplicationResult<Self> {
        let Some(dto) = read_json_file::<AiAccessFileDto>(&config_dir.join(AI_ACCESS_FILE_NAME))?
        else {
            return Ok(Self::default());
        };
        check_schema_version(&dto.schema_version, CURRENT_AI_ACCESS_SCHEMA_VERSION)?;
        let projects = dto
            .projects
            .iter()
            .map(|entry| {
                Ok(AiProjectEntry {
                    project_id: ProjectId::parse(&entry.project_id)?,
                    folder: PathBuf::from(&entry.folder),
                    allow_write: entry.allow_write,
                    until_app_exits: entry.allow_write && entry.until_app_exits,
                })
            })
            .collect::<ApplicationResult<Vec<_>>>()?;
        let current_project_id = match &dto.current_project_id {
            Some(id) => Some(ProjectId::parse(id)?),
            None => None,
        };
        let mut list = Self {
            current_project_id,
            projects,
        };
        list.normalize();
        Ok(list)
    }

    pub fn write(&self, config_dir: &Path) -> ApplicationResult<()> {
        write_json_file(
            config_dir,
            AI_ACCESS_FILE_NAME,
            &AiAccessFileDto {
                schema_version: Number::from(CURRENT_AI_ACCESS_SCHEMA_VERSION),
                current_project_id: self.current_project_id.map(|id| id.to_string()),
                projects: self
                    .projects
                    .iter()
                    .map(|entry| AiAccessProjectDto {
                        project_id: entry.project_id.to_string(),
                        folder: entry.folder.to_string_lossy().into_owned(),
                        allow_write: entry.allow_write,
                        until_app_exits: entry.until_app_exits,
                    })
                    .collect(),
            },
        )?;
        Ok(())
    }

    /// A hand-edited file may repeat a Project (the first, newest, entry wins) or be too
    /// long.
    fn normalize(&mut self) {
        let mut seen = Vec::new();
        self.projects.retain(|entry| {
            let first = !seen.contains(&entry.project_id);
            seen.push(entry.project_id);
            first
        });
        self.projects.truncate(MAX_AI_ACCESS_PROJECTS);
    }

    pub fn find(&self, project_id: &ProjectId) -> Option<&AiProjectEntry> {
        self.projects
            .iter()
            .find(|entry| &entry.project_id == project_id)
    }

    /// The Project used last in the app, when it is offered to AI.
    pub fn current(&self) -> Option<&AiProjectEntry> {
        self.current_project_id.and_then(|id| self.find(&id))
    }

    /// The Project was opened or brought to the front in the app: it becomes the current
    /// one. It is not offered to AI by this; a listed Project that moved to another folder
    /// is followed there.
    pub fn record_used(&mut self, project_id: ProjectId, folder: &Path) {
        if let Some(entry) = self
            .projects
            .iter_mut()
            .find(|entry| entry.project_id == project_id)
        {
            entry.folder = plain_path(folder);
        }
        self.current_project_id = Some(project_id);
    }

    /// Offers the Project to AI, read-only, at the top of the list. A Project already listed
    /// keeps its place and permission (its folder is updated).
    pub fn add(&mut self, project_id: ProjectId, folder: &Path) {
        if let Some(entry) = self
            .projects
            .iter_mut()
            .find(|entry| entry.project_id == project_id)
        {
            entry.folder = plain_path(folder);
            return;
        }
        self.projects.insert(
            0,
            AiProjectEntry {
                project_id,
                folder: plain_path(folder),
                allow_write: false,
                until_app_exits: false,
            },
        );
        self.normalize();
    }

    pub fn set_allow_write(
        &mut self,
        project_id: &ProjectId,
        allow_write: bool,
    ) -> ApplicationResult<()> {
        let entry = self
            .projects
            .iter_mut()
            .find(|entry| &entry.project_id == project_id)
            .ok_or_else(not_listed)?;
        entry.allow_write = allow_write;
        // A choice made on the screen is lasting.
        entry.until_app_exits = false;
        Ok(())
    }

    /// The user allowed an AI's request: the Project is offered (added when it was not) and
    /// may be changed, until the app exits when `until_app_exits`.
    pub fn grant_write(&mut self, project_id: ProjectId, folder: &Path, until_app_exits: bool) {
        self.add(project_id, folder);
        if let Some(entry) = self
            .projects
            .iter_mut()
            .find(|entry| entry.project_id == project_id)
        {
            // A lasting permission is not shortened by a "this time only" answer.
            let lasting = entry.allow_write && !entry.until_app_exits;
            entry.allow_write = true;
            entry.until_app_exits = until_app_exits && !lasting;
        }
    }

    /// The app exits (or starts after an exit it could not see): "this time only" ends.
    pub fn end_grants_until_app_exits(&mut self) {
        for entry in &mut self.projects {
            if entry.until_app_exits {
                entry.allow_write = false;
                entry.until_app_exits = false;
            }
        }
    }

    /// The Project is no longer offered to AI (until the user adds it again).
    pub fn remove(&mut self, project_id: &ProjectId) -> ApplicationResult<()> {
        if self.find(project_id).is_none() {
            return Err(not_listed());
        }
        self.projects
            .retain(|entry| &entry.project_id != project_id);
        Ok(())
    }
}

/// What the app's AI integration screen shows. The paths are display text only (like a
/// folder selection's `displayPath`): the Frontend shows and copies them, and every command
/// names a Project by its id, never by a path.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAccessOverview {
    pub mcp_server: McpServerLocation,
    pub projects: Vec<AiAccessProjectView>,
    /// The Project the asking window has open, for "add the open Project" (`None`: no
    /// Project is open there).
    pub open_project: Option<OpenProjectView>,
    pub load_issue: Option<ApplicationError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerLocation {
    pub display_path: String,
    /// Whether the file is there (a development build may not have built it).
    pub found: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAccessProjectView {
    pub project_id: String,
    /// `None` when the folder no longer holds this Project (moved, deleted, replaced).
    pub name: Option<String>,
    pub folder_display: String,
    pub allow_write: bool,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectView {
    pub project_id: String,
    /// Whether it is offered to AI already.
    pub listed: bool,
}

/// Where the MCP server is: beside the app's own executable.
pub fn mcp_server_path(app_executable: &Path) -> PathBuf {
    app_executable.with_file_name(format!(
        "{MCP_SERVER_EXECUTABLE_STEM}{}",
        std::env::consts::EXE_SUFFIX
    ))
}

/// The name of a listed Project, read from its folder now; `None` when the folder no
/// longer holds that Project.
pub fn listed_project_name(entry: &AiProjectEntry) -> Option<String> {
    read_project_identity(&entry.folder)
        .ok()
        .filter(|identity| identity.project_id == entry.project_id)
        .map(|identity| identity.name)
}

pub fn ai_access_overview(
    list: ApplicationResult<AiAccessList>,
    mcp_server: &Path,
    open_project: Option<ProjectId>,
) -> AiAccessOverview {
    let (list, load_issue) = match list {
        Ok(list) => (list, None),
        Err(issue) => (AiAccessList::default(), Some(issue)),
    };
    let current = list.current_project_id;
    AiAccessOverview {
        mcp_server: McpServerLocation {
            display_path: plain_path(mcp_server).to_string_lossy().into_owned(),
            found: mcp_server.is_file(),
        },
        open_project: open_project.map(|project_id| OpenProjectView {
            project_id: project_id.to_string(),
            listed: list.find(&project_id).is_some(),
        }),
        projects: list
            .projects
            .iter()
            .map(|entry| AiAccessProjectView {
                project_id: entry.project_id.to_string(),
                name: listed_project_name(entry),
                folder_display: plain_path(&entry.folder).to_string_lossy().into_owned(),
                allow_write: entry.allow_write,
                current: current == Some(entry.project_id),
            })
            .collect(),
        load_issue,
    }
}

fn not_listed() -> ApplicationError {
    ApplicationError::entity_not_found("the Project is not in the AI access list")
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIRST: &str = "01928f3a-0000-7000-8000-000000000001";
    const SECOND: &str = "01928f3a-0000-7000-8000-000000000002";

    fn id(text: &str) -> ProjectId {
        ProjectId::parse(text).unwrap()
    }

    #[test]
    fn opening_a_project_makes_it_current_without_offering_it() {
        let mut list = AiAccessList::default();
        list.record_used(id(FIRST), Path::new("/p/first"));
        assert_eq!(list.current_project_id, Some(id(FIRST)));
        assert!(list.projects.is_empty());
        assert!(list.current().is_none());
    }

    #[test]
    fn an_added_project_is_read_only_at_the_top_and_keeps_its_place_and_permission() {
        let mut list = AiAccessList::default();
        list.add(id(FIRST), Path::new("/p/first"));
        list.set_allow_write(&id(FIRST), true).unwrap();
        list.add(id(SECOND), Path::new("/p/second"));
        assert_eq!(list.projects[0].project_id, id(SECOND));
        assert!(!list.projects[0].allow_write);

        // Added again or opened from another folder: same place, same permission.
        list.add(id(FIRST), Path::new("/p/moved"));
        list.record_used(id(FIRST), Path::new("/p/moved-again"));
        assert_eq!(list.projects.len(), 2);
        assert_eq!(list.projects[1].folder, PathBuf::from("/p/moved-again"));
        assert!(list.projects[1].allow_write);
        assert_eq!(list.current().unwrap().project_id, id(FIRST));
    }

    #[test]
    fn an_allowed_request_adds_the_project_and_this_time_only_ends_with_the_app() {
        let mut list = AiAccessList::default();
        list.grant_write(id(FIRST), Path::new("/p/first"), true);
        assert!(list.projects[0].allow_write);
        assert!(list.projects[0].until_app_exits);

        list.add(id(SECOND), Path::new("/p/second"));
        list.set_allow_write(&id(SECOND), true).unwrap();
        // "This time only" does not shorten a lasting permission.
        list.grant_write(id(SECOND), Path::new("/p/second"), true);
        assert!(!list.find(&id(SECOND)).unwrap().until_app_exits);

        list.end_grants_until_app_exits();
        assert!(!list.find(&id(FIRST)).unwrap().allow_write);
        assert!(list.find(&id(SECOND)).unwrap().allow_write);
    }

    #[test]
    fn removing_a_project_stops_offering_it_but_it_stays_current() {
        let mut list = AiAccessList::default();
        list.add(id(FIRST), Path::new("/p/first"));
        list.record_used(id(FIRST), Path::new("/p/first"));
        list.remove(&id(FIRST)).unwrap();
        assert!(list.current().is_none());
        assert_eq!(list.current_project_id, Some(id(FIRST)));
        assert!(list.projects.is_empty());
        assert!(list.remove(&id(FIRST)).is_err());
        assert!(list.set_allow_write(&id(FIRST), true).is_err());
    }

    #[test]
    fn the_mcp_server_is_looked_for_beside_the_app() {
        let path = mcp_server_path(Path::new("/opt/dawn/design-dawn"));
        assert_eq!(path.parent(), Some(Path::new("/opt/dawn")));
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(MCP_SERVER_EXECUTABLE_STEM));
    }

    #[test]
    fn the_overview_marks_the_current_project_and_a_folder_that_lost_its_project() {
        let mut list = AiAccessList::default();
        list.add(id(FIRST), Path::new("/nowhere/first"));
        list.record_used(id(FIRST), Path::new("/nowhere/first"));
        let overview = ai_access_overview(
            Ok(list),
            Path::new("/nowhere/design-dawn-mcp"),
            Some(id(SECOND)),
        );
        assert!(!overview.mcp_server.found);
        assert_eq!(overview.projects.len(), 1);
        assert!(overview.projects[0].current);
        assert_eq!(overview.projects[0].name, None);
        assert!(overview.load_issue.is_none());
        let open = overview.open_project.unwrap();
        assert_eq!(open.project_id, SECOND);
        assert!(!open.listed);

        let broken = ai_access_overview(
            Err(ApplicationError::entity_not_found("x")),
            Path::new("/nowhere/design-dawn-mcp"),
            None,
        );
        assert!(broken.projects.is_empty());
        assert!(broken.load_issue.is_some());
    }

    #[test]
    fn windows_verbatim_paths_are_kept_and_shown_in_the_plain_form() {
        assert_eq!(
            plain_path(Path::new(r"\\?\C:\Users\me\order-service")),
            PathBuf::from(r"C:\Users\me\order-service")
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\UNC\server\share\p")),
            PathBuf::from(r"\\server\share\p")
        );
        assert_eq!(
            plain_path(Path::new("/home/me/p")),
            PathBuf::from("/home/me/p")
        );

        let mut list = AiAccessList::default();
        list.add(id(FIRST), Path::new(r"\\?\C:\work\order"));
        assert_eq!(list.projects[0].folder, PathBuf::from(r"C:\work\order"));
        // A list written before (with the prefix) is shown plainly too.
        list.projects[0].folder = PathBuf::from(r"\\?\C:\work\order");
        let overview =
            ai_access_overview(Ok(list), Path::new(r"\\?\C:\app\design-dawn-mcp.exe"), None);
        assert_eq!(overview.projects[0].folder_display, r"C:\work\order");
        assert_eq!(
            overview.mcp_server.display_path,
            r"C:\app\design-dawn-mcp.exe"
        );
    }

    #[test]
    fn the_list_is_bounded() {
        let mut list = AiAccessList::default();
        for index in 0..=MAX_AI_ACCESS_PROJECTS {
            let text = format!("01928f3a-0000-7000-8000-{index:012}");
            list.add(id(&text), Path::new("/p"));
        }
        assert_eq!(list.projects.len(), MAX_AI_ACCESS_PROJECTS);
    }

    #[test]
    fn it_survives_a_round_trip_through_the_file_and_a_missing_file_is_empty() {
        let directory =
            std::env::temp_dir().join(format!("dawn-ai-access-{}", uuid::Uuid::now_v7().simple()));
        assert_eq!(
            AiAccessList::read(&directory).unwrap(),
            AiAccessList::default()
        );
        let mut list = AiAccessList::default();
        list.add(id(FIRST), Path::new("/p/first"));
        list.add(id(SECOND), Path::new("/p/second"));
        list.record_used(id(SECOND), Path::new("/p/second"));
        list.set_allow_write(&id(FIRST), true).unwrap();
        list.write(&directory).unwrap();
        assert_eq!(AiAccessList::read(&directory).unwrap(), list);
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn a_hand_edited_file_is_normalized_or_refused() {
        let directory =
            std::env::temp_dir().join(format!("dawn-ai-access-{}", uuid::Uuid::now_v7().simple()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(AI_ACCESS_FILE_NAME);
        std::fs::write(
            &path,
            format!(
                r#"{{"schemaVersion":1,"currentProjectId":"{SECOND}","projects":[
                {{"projectId":"{FIRST}","folder":"/a","allowWrite":true}},
                {{"projectId":"{FIRST}","folder":"/b","allowWrite":false}}]}}"#
            ),
        )
        .unwrap();
        let list = AiAccessList::read(&directory).unwrap();
        assert_eq!(list.projects.len(), 1);
        assert_eq!(list.projects[0].folder, PathBuf::from("/a"));
        // The current Project need not be offered.
        assert_eq!(list.current_project_id, Some(id(SECOND)));
        assert!(list.current().is_none());

        std::fs::write(&path, r#"{"schemaVersion":2,"projects":[]}"#).unwrap();
        assert!(AiAccessList::read(&directory).is_err());
        std::fs::write(
            &path,
            r#"{"schemaVersion":1,"projects":[{"projectId":"x","folder":"/a","allowWrite":true}]}"#,
        )
        .unwrap();
        assert!(AiAccessList::read(&directory).is_err());
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
