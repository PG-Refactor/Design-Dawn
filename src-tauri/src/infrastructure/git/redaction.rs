//! Removes credentials from text that is logged: git's
//! stderr can quote a remote URL such as `https://user:token@host/repo.git`.

use super::constants::REDACTED_USER_INFORMATION;

const URL_SCHEME_SEPARATOR: &str = "://";
const USER_INFORMATION_END: char = '@';

/// Replaces the user information (`user:password@`, `token@`) of every URL in `text`.
pub fn redact_credentials(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(position) = rest.find(URL_SCHEME_SEPARATOR) {
        let authority_start = position + URL_SCHEME_SEPARATOR.len();
        result.push_str(&rest[..authority_start]);
        rest = &rest[authority_start..];
        // The authority ends at the first of these; an `@` inside it closes the user
        // information. `@` after a path separator belongs to the path.
        let authority_end = rest
            .find(|character: char| {
                character == '/'
                    || character == '?'
                    || character == '#'
                    || character.is_whitespace()
            })
            .unwrap_or(rest.len());
        if let Some(at) = rest[..authority_end].rfind(USER_INFORMATION_END) {
            result.push_str(REDACTED_USER_INFORMATION);
            rest = &rest[at..];
        }
    }
    result.push_str(rest);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_and_password_are_replaced() {
        assert_eq!(
            redact_credentials(
                "fatal: unable to access 'https://user:s3cret@example.com/r.git/': x"
            ),
            "fatal: unable to access 'https://***@example.com/r.git/': x"
        );
    }

    #[test]
    fn a_token_without_password_is_replaced() {
        assert_eq!(
            redact_credentials("remote: ssh://ghp_abc123@host:22/path"),
            "remote: ssh://***@host:22/path"
        );
    }

    #[test]
    fn several_urls_in_one_text_are_all_redacted() {
        assert_eq!(
            redact_credentials("a https://u:p@one.example/x b https://v:q@two.example/y"),
            "a https://***@one.example/x b https://***@two.example/y"
        );
    }

    #[test]
    fn urls_without_user_information_are_unchanged() {
        let text = "https://example.com/path@version and ssh://host/repo";
        assert_eq!(redact_credentials(text), text);
    }

    #[test]
    fn a_password_containing_an_at_sign_is_fully_removed() {
        assert_eq!(
            redact_credentials("https://user:p@ss@example.com/r"),
            "https://***@example.com/r"
        );
    }

    #[test]
    fn text_without_urls_is_unchanged() {
        let text = "fatal: detected dubious ownership in repository at '/home/a@b/c'";
        assert_eq!(redact_credentials(text), text);
    }
}
