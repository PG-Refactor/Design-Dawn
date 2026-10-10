//! Opening and closing a Project on behalf of one window (docs/architecture.md §11.0.1):
//! a Project is open in at most one window, and a window has at most one Project. The
//! registry holds the relation and `ProjectSessions` the data; the two always change together
//! here. Callers lock `ProjectSessions` first and the registry second, never the reverse.

use std::path::Path;

use super::error::{ApplicationError, ErrorKind};
use super::project_operations::{self, LoadedProject, PreparedEntryPoint};
use super::session::ProjectSessions;
use super::snapshot::ProjectSnapshot;
use super::window_registry::WindowRegistry;
use crate::domain::entity_id::ProjectId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowOpenError {
    /// Another window has the Project. The caller brings that window to the front.
    OpenInOtherWindow {
        window_label: String,
    },
    Failed(ApplicationError),
}

impl From<ApplicationError> for WindowOpenError {
    fn from(error: ApplicationError) -> Self {
        Self::Failed(error)
    }
}

impl From<WindowOpenError> for ApplicationError {
    fn from(error: WindowOpenError) -> Self {
        match error {
            WindowOpenError::OpenInOtherWindow { window_label } => Self::new(
                ErrorKind::ProjectOpenInOtherWindow,
                format!("the project is open in window {window_label}"),
            ),
            WindowOpenError::Failed(error) => error,
        }
    }
}

type OpenResult<T> = Result<T, WindowOpenError>;

/// Binds the Project to the window and drops the session of the Project the window had
/// before. Nothing changes when another window owns the Project.
fn bind_project(
    sessions: &mut ProjectSessions,
    registry: &mut WindowRegistry,
    window_label: &str,
    project_id: ProjectId,
) -> OpenResult<()> {
    let previous = registry.bind(window_label, project_id).map_err(|owner| {
        WindowOpenError::OpenInOtherWindow {
            window_label: owner,
        }
    })?;
    if let Some(previous) = previous {
        sessions.remove(&previous);
    }
    Ok(())
}

/// The loaded Project becomes the window's. The session is registered only after the binding
/// succeeded, so a refused open leaves the other window's session untouched.
pub fn admit_loaded_project(
    sessions: &mut ProjectSessions,
    registry: &mut WindowRegistry,
    window_label: &str,
    loaded: LoadedProject,
) -> OpenResult<ProjectSnapshot> {
    bind_project(
        sessions,
        registry,
        window_label,
        *loaded.session.project_id(),
    )?;
    sessions.insert(loaded.session);
    Ok(loaded.snapshot)
}

pub fn open_project_in_window(
    sessions: &mut ProjectSessions,
    registry: &mut WindowRegistry,
    window_label: &str,
    project_root: &Path,
) -> OpenResult<ProjectSnapshot> {
    let loaded = project_operations::load_project(project_root)?;
    admit_loaded_project(sessions, registry, window_label, loaded)
}

/// Reads the window's own Project again from its root on disk, like a fresh open of the same
/// Project in this window: the new session replaces the old one, so every Document counts
/// as not open until the Frontend loads it again. No path comes from the caller; the root is
/// the one the session already has. Nothing changes when the window does not have
/// `project_id` open or when reading fails.
pub fn reload_project_in_window(
    sessions: &mut ProjectSessions,
    registry: &mut WindowRegistry,
    window_label: &str,
    project_id: &ProjectId,
) -> OpenResult<ProjectSnapshot> {
    registry.ensure_bound(window_label, project_id)?;
    let project_root = sessions.get(project_id)?.root().to_path_buf();
    open_project_in_window(sessions, registry, window_label, &project_root)
}

/// What `take_open_request` returns once the Project is the window's.
pub struct AdmittedEntryPoint {
    pub snapshot: ProjectSnapshot,
    pub document_id: String,
    pub resolution: project_operations::EntryPointResolution,
}

pub fn admit_prepared_entry_point(
    sessions: &mut ProjectSessions,
    registry: &mut WindowRegistry,
    window_label: &str,
    prepared: PreparedEntryPoint,
) -> OpenResult<AdmittedEntryPoint> {
    let snapshot = admit_loaded_project(sessions, registry, window_label, prepared.loaded)?;
    Ok(AdmittedEntryPoint {
        snapshot,
        document_id: prepared.document_id,
        resolution: prepared.resolution,
    })
}

pub fn create_project_in_window(
    sessions: &mut ProjectSessions,
    registry: &mut WindowRegistry,
    window_label: &str,
    project_root: &Path,
    name: &str,
) -> OpenResult<ProjectSnapshot> {
    let snapshot = project_operations::create_project(sessions, project_root, name)?;
    let project_id =
        ProjectId::parse(&snapshot.project.project_id).map_err(ApplicationError::from)?;
    // A fresh ID cannot be bound elsewhere; if it somehow is, the new session must not stay.
    if let Err(error) = bind_project(sessions, registry, window_label, project_id) {
        sessions.remove(&project_id);
        return Err(error);
    }
    Ok(snapshot)
}

/// The window closed its Project (the window itself stays).
pub fn close_window_project(
    sessions: &mut ProjectSessions,
    registry: &mut WindowRegistry,
    window_label: &str,
) {
    if let Some(project_id) = registry.unbind(window_label) {
        sessions.remove(&project_id);
    }
}

/// The window is gone: forget it and its Project's session.
pub fn release_window_project(
    sessions: &mut ProjectSessions,
    registry: &mut WindowRegistry,
    window_label: &str,
) {
    if let Some(project_id) = registry.unregister(window_label) {
        sessions.remove(&project_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::error::ApplicationResult;

    fn parsed(id: &str) -> ProjectId {
        ProjectId::parse(id).unwrap()
    }

    fn empty_project_root(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let base =
            std::env::temp_dir().join(format!("design-dawn-binding-{}", uuid::Uuid::now_v7()));
        (base.clone(), base.join(name))
    }

    fn create(
        sessions: &mut ProjectSessions,
        registry: &mut WindowRegistry,
        label: &str,
        root: &Path,
    ) -> ProjectId {
        let snapshot = create_project_in_window(sessions, registry, label, root, "p").unwrap();
        parsed(&snapshot.project.project_id)
    }

    #[test]
    fn creating_binds_the_project_and_a_second_create_replaces_the_first() {
        let (base, first_root) = empty_project_root("one");
        let second_root = base.join("two");
        let mut sessions = ProjectSessions::default();
        let mut registry = WindowRegistry::default();

        let first = create(&mut sessions, &mut registry, "main", &first_root);
        assert_eq!(registry.project_of("main"), Some(first));
        assert!(sessions.get(&first).is_ok());

        let second = create(&mut sessions, &mut registry, "main", &second_root);
        assert_eq!(registry.project_of("main"), Some(second));
        assert!(
            sessions.get(&first).is_err(),
            "the replaced session is dropped"
        );
        assert!(sessions.get(&second).is_ok());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn reopening_a_project_owned_by_another_window_is_refused_and_keeps_its_session() {
        let (base, root) = empty_project_root("one");
        let mut sessions = ProjectSessions::default();
        let mut registry = WindowRegistry::default();
        let project = create(&mut sessions, &mut registry, "main", &root);

        let outcome = open_project_in_window(&mut sessions, &mut registry, "window-1", &root);

        assert_eq!(
            outcome,
            Err(WindowOpenError::OpenInOtherWindow {
                window_label: "main".to_owned()
            })
        );
        assert!(sessions.get(&project).is_ok());
        assert_eq!(registry.project_of("window-1"), None);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn closing_the_project_drops_the_session_and_frees_the_project() {
        let (base, root) = empty_project_root("one");
        let mut sessions = ProjectSessions::default();
        let mut registry = WindowRegistry::default();
        let project = create(&mut sessions, &mut registry, "main", &root);

        close_window_project(&mut sessions, &mut registry, "main");

        assert!(sessions.get(&project).is_err());
        assert_eq!(registry.project_of("main"), None);
        let reopened: ApplicationResult<_> =
            open_project_in_window(&mut sessions, &mut registry, "window-1", &root)
                .map_err(ApplicationError::from);
        assert!(reopened.is_ok());
        assert_eq!(registry.project_of("window-1"), Some(project));
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn releasing_a_window_drops_its_session_and_registration() {
        let (base, root) = empty_project_root("one");
        let mut sessions = ProjectSessions::default();
        let mut registry = WindowRegistry::default();
        let project = create(&mut sessions, &mut registry, "window-1", &root);

        release_window_project(&mut sessions, &mut registry, "window-1");

        assert!(sessions.get(&project).is_err());
        assert_eq!(registry.find_window_by_project(&project), None);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn the_conflict_converts_to_the_public_error_kind() {
        let error = ApplicationError::from(WindowOpenError::OpenInOtherWindow {
            window_label: "main".to_owned(),
        });
        assert_eq!(error.kind, ErrorKind::ProjectOpenInOtherWindow);
    }
}
