// The views of an editor that has a GUI next to the Source textarea.
export type TextBlockEditorView = "source" | "gui";

// Which view a Mermaid block's editor opens in when the GUI can edit the diagram: the GUI
// first, since most edits are done there.
export const MERMAID_EDITOR_INITIAL_VIEW: TextBlockEditorView = "gui";
// For a diagram the GUI cannot edit (a type without a GUI, an empty block, statements the
// GUI does not understand), the editor opens where it can be edited.
export const MERMAID_EDITOR_FALLBACK_VIEW: TextBlockEditorView = "source";
