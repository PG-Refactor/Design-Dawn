// Document session settings (docs/architecture.md §9.2, §10). Tunable values, not spec.

// Undo steps kept per Document; the oldest step is dropped beyond this.
export const UNDO_HISTORY_LIMIT = 200;

// Inactivity before pending metadata changes are saved automatically.
export const AUTO_SAVE_DELAY_MS = 800;
