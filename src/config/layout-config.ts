// Workspace layout settings. The Project Tree width limits are validated by Rust as well
// (`PROJECT_TREE_WIDTH_MIN` / `_MAX` / `DEFAULT_PROJECT_TREE_WIDTH` in
// src-tauri/src/application/local_state/constants.rs); keep the two in sync. The shared
// IPC fixtures (fixtures/ipc/local-state-commands.json) cover the range.
export const LAYOUT_CONFIG = {
  projectTree: {
    minWidthPx: 160,
    maxWidthPx: 640,
    // Used until the stored width is known and when none is stored.
    defaultWidthPx: 320,
    // Keyboard resizing on the splitter; Shift uses the larger step.
    keyStepPx: 16,
    largeKeyStepPx: 64,
  },
  // The document area (tabs + canvas) never gets narrower than this while dragging, so a
  // wide Project Tree cannot squeeze the canvas out of the window.
  documentAreaMinWidthPx: 320,
  // Grab area of the splitter between the Project Tree and the document area.
  splitterWidthPx: 8,
} as const;
