//! The name of the folder a new Project is created in, typed by the user next to the place
//! it goes. One path segment that is safe on every OS (the same rules as a stored path
//! segment); it may differ from the Project's display name.

use super::constants::{PATH_SEPARATOR, WINDOWS_PATH_SEPARATOR};
use super::content_path::check_segment;
use super::error::{DomainError, DomainErrorKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectFolderName(String);

impl ProjectFolderName {
    pub fn new(value: &str) -> Result<Self, DomainError> {
        let invalid = |detail: String| DomainError::new(DomainErrorKind::InvalidFolderName, detail);
        if value.contains(PATH_SEPARATOR) || value.contains(WINDOWS_PATH_SEPARATOR) {
            return Err(invalid(format!("more than one segment: {value:?}")));
        }
        check_segment(value).map_err(|error| invalid(error.detail))?;
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_name_is_one_safe_segment() {
        for valid in ["Order Service", "設計書", "project-1", "a.b"] {
            assert_eq!(ProjectFolderName::new(valid).unwrap().as_str(), valid);
        }
        for invalid in [
            "", "a/b", "a\\b", "..", ".", "name.", "name ", "CON", "aux.txt", "a:b", "a?b",
        ] {
            assert_eq!(
                ProjectFolderName::new(invalid).unwrap_err().kind,
                DomainErrorKind::InvalidFolderName,
                "{invalid:?}"
            );
        }
    }
}
