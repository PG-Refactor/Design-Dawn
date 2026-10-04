// Single place for the Tauri command contract: command names (docs/architecture.md §6.2)
// and the error identifiers (§6.3). Rust owns the identifiers; `commands-contract.test.ts`
// checks the command names against `src-tauri/src/commands/mod.rs`.

export const COMMANDS = {
  selectProjectFolder: "select_project_folder",
  createProject: "create_project",
  openProject: "open_project",
  saveProject: "save_project",
  createDocument: "create_document",
  loadDocument: "load_document",
  saveDocument: "save_document",
  createSheet: "create_sheet",
  saveSheet: "save_sheet",
  createBlockContent: "create_block_content",
  readBlockContent: "read_block_content",
  writeBlockContent: "write_block_content",
  deleteBlockContent: "delete_block_content",
  restoreBlockContent: "restore_block_content",
  deleteSheet: "delete_sheet",
  deleteDocument: "delete_document",
  getAppSettings: "get_app_settings",
  setThemePreference: "set_theme_preference",
  getSheetViewport: "get_sheet_viewport",
  saveSheetViewport: "save_sheet_viewport",
  importDroppedImages: "import_dropped_images",
  copyAssetToDocument: "copy_asset_to_document",
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

// The error identifiers are defined in the application layer (it names them in its
// ports); re-exported here so the contract tests keep one import point.
export {
  ASSET_ERROR_KINDS,
  CLIENT_ERROR_KINDS,
  FOLDER_SELECTION_ERROR_KINDS,
  PERSISTENCE_ERROR_KINDS,
  RUST_ONLY_DOMAIN_ERROR_KINDS,
  SESSION_ERROR_KINDS,
} from "../../application/ports/operation-error";

// Snapshot-related constants are defined next to the snapshot types in the application
// layer (its port names them); re-exported so the contract tests keep one import point.
export {
  ENTITY_STATES,
  type EntityState,
  FOLDER_SELECTION_STATUS,
  LOAD_ISSUE_KINDS,
  type LoadIssueKind,
} from "../../application/ports/persistence-types";
