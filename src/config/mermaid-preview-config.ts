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

// How far (in screen pixels) a click on the diagram picture may land from an edge line and
// still mean that edge. The lines are thin; this keeps them easy to hit without reaching
// over to a neighbour.
export const DIAGRAM_LINE_HIT_REACH_PX = 6;

// The height (in diagram units) of the click target of an empty flowchart subgraph. Mermaid
// draws it as its title only, on a frame of no height; the target is one label line high,
// centred on that frame, about the size of the title as drawn.
export const EMPTY_SUBGRAPH_HIT_HEIGHT = 24;
