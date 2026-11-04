//! Which Projects an AI client may use through `design-dawn-mcp`, kept in `ai-access.json`
//! in the app's config directory. The app records every Project it opens (newest first)
//! and which one was used last; the user decides per Project whether an AI may change it.
//! Only the app writes the file, so an AI can never grant itself write access: the MCP
//! server only reads it.

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiProjectEntry {
    pub project_id: ProjectId,
    /// The Project folder (the one holding `project.json`).
    pub folder: PathBuf,
    pub allow_write: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AiAccessList {
    /// The Project of the app window used last, if it is still listed.
    pub current_project_id: Option<ProjectId>,
    /// Newest first.
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
                    })
                    .collect(),
            },
        )?;
        Ok(())
    }

    /// A hand-edited file may repeat a Project (the first, newest, entry wins), name a
    /// current Project that is not listed, or be too long.
    fn normalize(&mut self) {
        let mut seen = Vec::new();
        self.projects.retain(|entry| {
            let first = !seen.contains(&entry.project_id);
            seen.push(entry.project_id);
            first
        });
        self.projects.truncate(MAX_AI_ACCESS_PROJECTS);
        if self
            .current_project_id
            .is_some_and(|id| self.find(&id).is_none())
        {
            self.current_project_id = None;
        }
    }

    pub fn find(&self, project_id: &ProjectId) -> Option<&AiProjectEntry> {
        self.projects
            .iter()
            .find(|entry| &entry.project_id == project_id)
    }

    pub fn current(&self) -> Option<&AiProjectEntry> {
        self.current_project_id.and_then(|id| self.find(&id))
    }

    /// The Project was opened or brought to the front in the app: it becomes the current
    /// one and moves to the top. A Project moved to another folder keeps its permission.
    /// A new Project starts read-only.
    pub fn record_used(&mut self, project_id: ProjectId, folder: &Path) {
        let allow_write = self
            .find(&project_id)
            .is_some_and(|entry| entry.allow_write);
        self.projects.retain(|entry| entry.project_id != project_id);
        self.projects.insert(
            0,
            AiProjectEntry {
                project_id,
                folder: folder.to_path_buf(),
                allow_write,
            },
        );
        self.current_project_id = Some(project_id);
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
        Ok(())
    }

    /// The Project is no longer offered to an AI (until the app opens it again).
    pub fn remove(&mut self, project_id: &ProjectId) -> ApplicationResult<()> {
        if self.find(project_id).is_none() {
            return Err(not_listed());
        }
        self.projects
            .retain(|entry| &entry.project_id != project_id);
        if self.current_project_id.as_ref() == Some(project_id) {
            self.current_project_id = None;
        }
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
) -> AiAccessOverview {
    let (list, load_issue) = match list {
        Ok(list) => (list, None),
        Err(issue) => (AiAccessList::default(), Some(issue)),
    };
    let current = list.current_project_id;
    AiAccessOverview {
        mcp_server: McpServerLocation {
            display_path: mcp_server.to_string_lossy().into_owned(),
            found: mcp_server.is_file(),
        },
        projects: list
            .projects
            .iter()
            .map(|entry| AiAccessProjectView {
                project_id: entry.project_id.to_string(),
                name: listed_project_name(entry),
                folder_display: entry.folder.to_string_lossy().into_owned(),
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
    fn a_used_project_moves_to_the_top_keeps_its_permission_and_becomes_current() {
        let mut list = AiAccessList::default();
        list.record_used(id(FIRST), Path::new("/p/first"));
        list.set_allow_write(&id(FIRST), true).unwrap();
        list.record_used(id(SECOND), Path::new("/p/second"));
        assert_eq!(list.current().unwrap().project_id, id(SECOND));
        assert!(!list.current().unwrap().allow_write);

        list.record_used(id(FIRST), Path::new("/p/moved"));
        assert_eq!(list.projects.len(), 2);
        assert_eq!(list.projects[0].folder, PathBuf::from("/p/moved"));
        assert!(list.projects[0].allow_write);
        assert_eq!(list.current_project_id, Some(id(FIRST)));
    }

    #[test]
    fn removing_the_current_project_leaves_none_current() {
        let mut list = AiAccessList::default();
        list.record_used(id(FIRST), Path::new("/p/first"));
        list.remove(&id(FIRST)).unwrap();
        assert!(list.current().is_none());
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
        list.record_used(id(FIRST), Path::new("/nowhere/first"));
        let overview = ai_access_overview(Ok(list), Path::new("/nowhere/design-dawn-mcp"));
        assert!(!overview.mcp_server.found);
        assert_eq!(overview.projects.len(), 1);
        assert!(overview.projects[0].current);
        assert_eq!(overview.projects[0].name, None);
        assert!(overview.load_issue.is_none());

        let broken = ai_access_overview(
            Err(ApplicationError::entity_not_found("x")),
            Path::new("/nowhere/design-dawn-mcp"),
        );
        assert!(broken.projects.is_empty());
        assert!(broken.load_issue.is_some());
    }

    #[test]
    fn the_list_is_bounded() {
        let mut list = AiAccessList::default();
        for index in 0..=MAX_AI_ACCESS_PROJECTS {
            let text = format!("01928f3a-0000-7000-8000-{index:012}");
            list.record_used(id(&text), Path::new("/p"));
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
        list.record_used(id(FIRST), Path::new("/p/first"));
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
