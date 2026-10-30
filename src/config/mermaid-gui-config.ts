// The views of an editor that has a GUI next to the Source textarea.
export type TextBlockEditorView = "source" | "gui";

// Which view a Mermaid block's editor opens in. Source keeps the behaviour from before the
// GUI existed (the textarea is focused at once); revisit once the GUI covers more diagram
// types.
export const MERMAID_EDITOR_INITIAL_VIEW: TextBlockEditorView = "source";
