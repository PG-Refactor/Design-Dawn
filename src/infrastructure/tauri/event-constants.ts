// Event names Rust emits to the main window; they must match
// `src-tauri/src/commands/drag_drop.rs`.
export const EVENTS = {
  filesDropped: "dawn://files-dropped",
  dragState: "dawn://drag-state",
} as const;
