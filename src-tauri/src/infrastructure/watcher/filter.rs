use std::path::Path;

use crate::domain::constants::PATH_SEPARATOR;
use crate::infrastructure::file_format::constants::{DOCUMENTS_DIRECTORY_NAME, PROJECT_FILE_NAME};
use crate::infrastructure::filesystem::atomic_write::is_temp_file_name;

/// The Project-root-relative `/`-separated path of an event path, or `None` when the app has
/// no interest in it: outside the Project, not UTF-8, an Atomic Save temp file, or anything
/// except `project.json` and what lives under `documents/` (`.git`, `.gitattributes`, the
/// `.dawn`, files a user keeps next to the Project).
pub fn watched_relative_path(root: &Path, event_path: &Path) -> Option<String> {
    let relative = event_path.strip_prefix(root).ok()?;
    let mut segments = Vec::new();
    for component in relative.components() {
        match component {
            std::path::Component::Normal(segment) => segments.push(segment.to_str()?),
            _ => return None,
        }
    }
    let first = *segments.first()?;
    let is_project_file = segments.len() == 1 && first == PROJECT_FILE_NAME;
    if !is_project_file && first != DOCUMENTS_DIRECTORY_NAME {
        return None;
    }
    if segments.last().is_some_and(|name| is_temp_file_name(name)) {
        return None;
    }
    Some(segments.join(&PATH_SEPARATOR.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> &'static Path {
        Path::new("/projects/example")
    }

    fn relative(path: &str) -> Option<String> {
        watched_relative_path(root(), &root().join(path))
    }

    #[test]
    fn the_project_file_and_everything_under_documents_are_watched() {
        assert_eq!(relative("project.json").as_deref(), Some("project.json"));
        assert_eq!(
            relative("documents/a/sheets/s/blocks/markdown-1.md").as_deref(),
            Some("documents/a/sheets/s/blocks/markdown-1.md")
        );
        assert_eq!(relative("documents/a").as_deref(), Some("documents/a"));
        assert_eq!(relative("documents").as_deref(), Some("documents"));
    }

    #[test]
    fn git_the_entry_point_and_other_files_next_to_the_project_are_ignored() {
        assert_eq!(relative(".git/index"), None);
        assert_eq!(relative(".git"), None);
        assert_eq!(relative(".gitattributes"), None);
        assert_eq!(relative("example.dawn"), None);
        assert_eq!(relative("notes.txt"), None);
        assert_eq!(relative("project.json/nested"), None);
    }

    #[test]
    fn atomic_save_temp_files_are_ignored_anywhere() {
        assert_eq!(relative(".project.json.dawn-tmp"), None);
        assert_eq!(relative("documents/a/.document.json.dawn-tmp"), None);
        assert_eq!(
            relative("documents/a/sheets/s/blocks/.markdown-1.md.dawn-tmp"),
            None
        );
    }

    #[test]
    fn a_path_outside_the_project_is_ignored() {
        assert_eq!(
            watched_relative_path(root(), Path::new("/projects/other/project.json")),
            None
        );
        assert_eq!(
            watched_relative_path(root(), Path::new("/projects/example")),
            None
        );
    }

    #[test]
    fn a_name_that_only_looks_like_the_documents_directory_is_ignored() {
        assert_eq!(relative("documents-old/a"), None);
    }
}
