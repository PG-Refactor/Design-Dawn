// Git settings (docs/git-development.md §11.12). Tunable values, not spec.

// Commits asked for per history page. Must stay within the page size Rust accepts
// (`HISTORY_LIMIT_MIN..=HISTORY_LIMIT_MAX` in src-tauri/src/infrastructure/git/constants.rs).
export const HISTORY_PAGE_SIZE = 50;

// Characters of a commit ID shown in the history list (the full ID stays reachable).
export const SHORT_COMMIT_ID_LENGTH = 7;
