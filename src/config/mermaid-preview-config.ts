// Mermaid preview settings. Tunable values, not spec. The
// security-relevant renderer settings live in features/mermaid/mermaid-config.ts instead.

// Quiet time after the last keystroke before the editor preview is drawn again. Layout runs
// on the main thread and cannot be interrupted, so drawing on every keystroke would stall
// typing on a large diagram.
export const MERMAID_PREVIEW_DEBOUNCE_MS = 300;

// The normal view draws as soon as the committed text or the theme changes.
export const MERMAID_IMMEDIATE_RENDER_DELAY_MS = 0;

// Characters of a Mermaid error message kept for display. Parser errors quote the source
// and can be long; the block is small, and the full source stays in the editor.
export const MERMAID_ERROR_MESSAGE_MAX_LENGTH = 600;
