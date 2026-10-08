//! Validation of Project-relative paths that cross the IPC boundary or come from git
//! (docs/git-development.md §11.7). Nothing is normalised: a path is accepted exactly as
//! given or rejected.

const SEPARATOR: char = '/';
const CURRENT_DIRECTORY: &str = ".";
const PARENT_DIRECTORY: &str = "..";
const DRIVE_SEPARATOR: char = ':';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidGitPath {
    Empty,
    NulCharacter,
    Backslash,
    /// Starts with `/` (also covers a UNC path written with forward slashes).
    Absolute,
    DriveLetter,
    /// An empty segment (`a//b`, trailing `/`), `.` or `..`.
    InvalidSegment,
}

/// Accepts a `/`-separated path of plain segments below the Project root.
pub fn validate_project_relative_path(path: &str) -> Result<&str, InvalidGitPath> {
    if path.is_empty() {
        return Err(InvalidGitPath::Empty);
    }
    if path.contains('\0') {
        return Err(InvalidGitPath::NulCharacter);
    }
    // Backslash is a separator on Windows, so `a\..\b` would escape the checks below.
    if path.contains('\\') {
        return Err(InvalidGitPath::Backslash);
    }
    if path.starts_with(SEPARATOR) {
        return Err(InvalidGitPath::Absolute);
    }
    if has_drive_letter(path) {
        return Err(InvalidGitPath::DriveLetter);
    }
    for segment in path.split(SEPARATOR) {
        if segment.is_empty() || segment == CURRENT_DIRECTORY || segment == PARENT_DIRECTORY {
            return Err(InvalidGitPath::InvalidSegment);
        }
    }
    Ok(path)
}

/// `C:`, `C:foo` and `C:/foo`: a letter followed by `:` at the start.
fn has_drive_letter(path: &str) -> bool {
    let mut characters = path.chars();
    matches!(
        (characters.next(), characters.next()),
        (Some(letter), Some(DRIVE_SEPARATOR)) if letter.is_ascii_alphabetic()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_relative_paths() {
        for path in [
            "a",
            "a/b/c.md",
            "documents/設計/sheet.json",
            "name with spaces.md",
            ".gitignore",
            "dir/.hidden",
            "a..b/c",
            "...",
            "1:/x",
        ] {
            assert_eq!(validate_project_relative_path(path), Ok(path), "{path}");
        }
    }

    #[test]
    fn rejects_every_unsafe_form() {
        let cases = [
            ("", InvalidGitPath::Empty),
            ("a\0b", InvalidGitPath::NulCharacter),
            ("a\\b", InvalidGitPath::Backslash),
            ("..\\x", InvalidGitPath::Backslash),
            ("\\\\server\\share", InvalidGitPath::Backslash),
            ("/etc/passwd", InvalidGitPath::Absolute),
            ("//server/share", InvalidGitPath::Absolute),
            ("C:", InvalidGitPath::DriveLetter),
            ("C:/x", InvalidGitPath::DriveLetter),
            ("c:x", InvalidGitPath::DriveLetter),
            ("a:b/c", InvalidGitPath::DriveLetter),
            (".", InvalidGitPath::InvalidSegment),
            ("..", InvalidGitPath::InvalidSegment),
            ("../x", InvalidGitPath::InvalidSegment),
            ("a/../b", InvalidGitPath::InvalidSegment),
            ("a/..", InvalidGitPath::InvalidSegment),
            ("./a", InvalidGitPath::InvalidSegment),
            ("a/./b", InvalidGitPath::InvalidSegment),
            ("a//b", InvalidGitPath::InvalidSegment),
            ("a/", InvalidGitPath::InvalidSegment),
        ];
        for (path, expected) in cases {
            assert_eq!(
                validate_project_relative_path(path),
                Err(expected),
                "{path:?}"
            );
        }
    }
}
