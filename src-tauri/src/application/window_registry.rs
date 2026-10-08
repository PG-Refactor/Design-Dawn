//! Which Project each window has open, and which window was focused last
//! (docs/architecture.md §11.0.1). Pure data keyed by window label strings, so it is testable
//! without Tauri; not persisted (windows do not outlive the process).

use std::collections::HashMap;

use super::error::{ApplicationError, ApplicationResult};
use crate::domain::entity_id::ProjectId;

#[derive(Debug, Clone, Default)]
struct WindowEntry {
    project: Option<ProjectId>,
    /// 0 = never focused. A larger number means focused more recently.
    focus_order: u64,
}

#[derive(Debug, Default)]
pub struct WindowRegistry {
    windows: HashMap<String, WindowEntry>,
    focus_counter: u64,
}

impl WindowRegistry {
    /// Idempotent. `bind` and `touch_focus` register a missing window themselves, so a window
    /// that was never announced (the mock windows of the tests, a window created by Step F
    /// before it registers) still works; the explicit call exists for `main` at set-up.
    pub fn register(&mut self, label: &str) {
        self.windows.entry(label.to_owned()).or_default();
    }

    /// Removes the window and returns the Project it had open, so the caller can drop that
    /// Project's session.
    pub fn unregister(&mut self, label: &str) -> Option<ProjectId> {
        self.windows.remove(label).and_then(|entry| entry.project)
    }

    pub fn project_of(&self, label: &str) -> Option<ProjectId> {
        self.windows.get(label).and_then(|entry| entry.project)
    }

    /// Binds `project` to the window. `Err(label)` when another window already has it (the
    /// caller brings that window forward). On success returns the Project the window had
    /// before when it was a different one, so the caller can drop its session.
    pub fn bind(&mut self, label: &str, project: ProjectId) -> Result<Option<ProjectId>, String> {
        if let Some(owner) = self.find_window_by_project(&project) {
            if owner != label {
                return Err(owner.to_owned());
            }
        }
        let entry = self.windows.entry(label.to_owned()).or_default();
        let previous = entry.project.replace(project);
        Ok(previous.filter(|previous| *previous != project))
    }

    /// The Project the window had open, if any. The window stays registered.
    pub fn unbind(&mut self, label: &str) -> Option<ProjectId> {
        self.windows
            .get_mut(label)
            .and_then(|entry| entry.project.take())
    }

    pub fn find_window_by_project(&self, project: &ProjectId) -> Option<&str> {
        self.windows
            .iter()
            .find(|(_, entry)| entry.project.as_ref() == Some(project))
            .map(|(label, _)| label.as_str())
    }

    pub fn touch_focus(&mut self, label: &str) {
        self.focus_counter += 1;
        self.windows
            .entry(label.to_owned())
            .or_default()
            .focus_order = self.focus_counter;
    }

    /// The window focused last; `None` when none was ever focused.
    pub fn most_recently_focused(&self) -> Option<&str> {
        self.windows
            .iter()
            .filter(|(_, entry)| entry.focus_order > 0)
            .max_by_key(|(_, entry)| entry.focus_order)
            .map(|(label, _)| label.as_str())
    }

    /// The one authorization rule for commands that take a `projectId`: the calling window
    /// must have exactly that Project open. An unknown window and an unbound window are the
    /// same case.
    pub fn ensure_bound(&self, label: &str, project: &ProjectId) -> ApplicationResult<()> {
        if self.project_of(label).as_ref() == Some(project) {
            Ok(())
        } else {
            Err(ApplicationError::project_not_open(format!(
                "project {project} is not open in window {label}"
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(number: u8) -> ProjectId {
        ProjectId::parse(&format!("01928f3a-0000-7000-8000-0000000000{number:02}")).unwrap()
    }

    #[test]
    fn bind_and_find_round_trip() {
        let mut registry = WindowRegistry::default();
        registry.register("main");
        assert_eq!(registry.bind("main", project(1)), Ok(None));
        assert_eq!(registry.find_window_by_project(&project(1)), Some("main"));
        assert_eq!(registry.project_of("main"), Some(project(1)));
        assert_eq!(registry.find_window_by_project(&project(2)), None);
    }

    #[test]
    fn binding_a_project_of_another_window_names_that_window_and_changes_nothing() {
        let mut registry = WindowRegistry::default();
        registry.bind("main", project(1)).unwrap();
        registry.bind("window-1", project(2)).unwrap();
        assert_eq!(
            registry.bind("window-1", project(1)),
            Err("main".to_owned())
        );
        assert_eq!(registry.project_of("window-1"), Some(project(2)));
        assert_eq!(registry.project_of("main"), Some(project(1)));
    }

    #[test]
    fn rebinding_the_same_project_keeps_it_and_reports_no_previous_project() {
        let mut registry = WindowRegistry::default();
        registry.bind("main", project(1)).unwrap();
        assert_eq!(registry.bind("main", project(1)), Ok(None));
        assert_eq!(registry.project_of("main"), Some(project(1)));
    }

    #[test]
    fn binding_another_project_returns_the_previous_one() {
        let mut registry = WindowRegistry::default();
        registry.bind("main", project(1)).unwrap();
        assert_eq!(registry.bind("main", project(2)), Ok(Some(project(1))));
        assert_eq!(registry.find_window_by_project(&project(1)), None);
        assert_eq!(registry.find_window_by_project(&project(2)), Some("main"));
    }

    #[test]
    fn unbind_returns_the_project_and_frees_it_for_another_window() {
        let mut registry = WindowRegistry::default();
        registry.bind("main", project(1)).unwrap();
        assert_eq!(registry.unbind("main"), Some(project(1)));
        assert_eq!(registry.unbind("main"), None);
        assert_eq!(registry.unbind("unknown"), None);
        assert_eq!(registry.bind("window-1", project(1)), Ok(None));
    }

    #[test]
    fn unregister_returns_the_project_and_forgets_the_window() {
        let mut registry = WindowRegistry::default();
        registry.bind("window-1", project(3)).unwrap();
        assert_eq!(registry.unregister("window-1"), Some(project(3)));
        assert_eq!(registry.find_window_by_project(&project(3)), None);
        assert_eq!(registry.unregister("window-1"), None);
    }

    #[test]
    fn the_most_recently_focused_window_follows_touch_order() {
        let mut registry = WindowRegistry::default();
        registry.register("main");
        registry.register("window-1");
        assert_eq!(registry.most_recently_focused(), None);
        registry.touch_focus("main");
        registry.touch_focus("window-1");
        assert_eq!(registry.most_recently_focused(), Some("window-1"));
        registry.touch_focus("main");
        assert_eq!(registry.most_recently_focused(), Some("main"));
        registry.unregister("main");
        assert_eq!(registry.most_recently_focused(), Some("window-1"));
    }

    #[test]
    fn only_the_window_with_the_project_is_authorized() {
        let mut registry = WindowRegistry::default();
        registry.bind("main", project(1)).unwrap();
        assert!(registry.ensure_bound("main", &project(1)).is_ok());
        assert!(registry.ensure_bound("main", &project(2)).is_err());
        assert!(registry.ensure_bound("window-1", &project(1)).is_err());
    }
}
