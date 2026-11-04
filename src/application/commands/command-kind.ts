// Identifiers of the Application Commands. Used as undo / redo
// labels. Paste and duplicate are `createBlocks` instances, not kinds of their own.
export const COMMAND_KINDS = {
  moveBlocks: "moveBlocks",
  resizeBlocks: "resizeBlocks",
  reorderBlocks: "reorderBlocks",
  createBlocks: "createBlocks",
  deleteBlocks: "deleteBlocks",
  renameSheet: "renameSheet",
  renameDocument: "renameDocument",
  moveSheet: "moveSheet",
  editBlockContent: "editBlockContent",
  setBlockCaption: "setBlockCaption",
} as const;

export type CommandKind = (typeof COMMAND_KINDS)[keyof typeof COMMAND_KINDS];
