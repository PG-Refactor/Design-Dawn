// Document session settings (docs/architecture.md §9.2, §10). Tunable values, not spec.

// Undo steps kept per Document; the oldest step is dropped beyond this.
export const UNDO_HISTORY_LIMIT = 200;

// Inactivity before pending metadata changes are saved automatically.
export const AUTO_SAVE_DELAY_MS = 800;

// Auto-save setting used until the stored one is known and when none is stored. Mirrors
// `DEFAULT_AUTO_SAVE` in src-tauri/src/application/local_state/constants.rs.
export const DEFAULT_AUTO_SAVE_ENABLED = true;
