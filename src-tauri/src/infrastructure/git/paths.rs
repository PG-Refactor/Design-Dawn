//! Validation of Project-relative paths that cross the IPC boundary or come from git
//! (docs/git-development.md §11.7). Nothing is normalised: a path is accepted exactly as
//! given or rejected.

use super::constants::PATHSPEC_SEPARATOR;

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

/// A path that passed [`validate_project_relative_path`]. Only the validator creates one, so
/// a function that takes this type cannot be handed an unchecked string (it is what reaches
/// git's stdin).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedGitPath(String);

impl ValidatedGitPath {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

/// Nothing to pass to git; the caller decides whether that is a no-op or an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EmptyPathList;

/// The stdin for `--pathspec-from-file=- --pathspec-file-nul`: every path followed by NUL.
/// With NUL separation git does no unquoting, so any byte of a validated path is literal.
pub fn pathspec_stdin(paths: &[ValidatedGitPath]) -> Result<Vec<u8>, EmptyPathList> {
    if paths.is_empty() {
        return Err(EmptyPathList);
    }
    let mut bytes = Vec::new();
    for path in paths {
        bytes.extend_from_slice(path.as_str().as_bytes());
        bytes.push(PATHSPEC_SEPARATOR);
    }
    Ok(bytes)
}

/// Accepts a `/`-separated path of plain segments below the Project root. A trailing `/`
/// (a directory-like path) is rejected: only files are addressed.
pub fn validate_project_relative_path(path: &str) -> Result<ValidatedGitPath, InvalidGitPath> {
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
    Ok(ValidatedGitPath(path.to_owned()))
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
            let validated = validate_project_relative_path(path).expect(path);
            assert_eq!(validated.as_str(), path);
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
            ("documents/", InvalidGitPath::InvalidSegment),
            ("D:/foo", InvalidGitPath::DriveLetter),
            ("C:\\foo", InvalidGitPath::Backslash),
            ("\\foo", InvalidGitPath::Backslash),
            ("\\\\?\\C:\\x", InvalidGitPath::Backslash),
            ("foo/bar\\baz", InvalidGitPath::Backslash),
            ("../foo", InvalidGitPath::InvalidSegment),
            ("foo/../bar", InvalidGitPath::InvalidSegment),
        ];
        for (path, expected) in cases {
            assert_eq!(
                validate_project_relative_path(path),
                Err(expected),
                "{path:?}"
            );
        }
    }

    #[test]
    fn pathspec_stdin_is_each_path_followed_by_nul() {
        let paths = ["a b.md", "日本語/x.md", ":(exclude)x"]
            .map(|path| validate_project_relative_path(path).unwrap());

        let bytes = pathspec_stdin(&paths).unwrap();

        assert_eq!(
            bytes,
            "a b.md\0日本語/x.md\0:(exclude)x\0".as_bytes().to_vec()
        );
    }

    #[test]
    fn pathspec_stdin_rejects_an_empty_list() {
        assert_eq!(pathspec_stdin(&[]), Err(EmptyPathList));
    }
}
