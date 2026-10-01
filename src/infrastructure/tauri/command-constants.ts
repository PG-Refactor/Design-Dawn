// Single place for the Tauri command contract: command names (docs/architecture.md §6.2)
// and the error identifiers (§6.3). Rust owns the identifiers; `commands-contract.test.ts`
// checks the command names against `src-tauri/src/commands/mod.rs`.

export const COMMANDS = {
  createProject: "create_project",
  openProject: "open_project",
  openEntryPoint: "open_entry_point",
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
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

export const PERSISTENCE_ERROR_KINDS = [
  "invalidJson",
  "invalidFileStructure",
  "invalidEncoding",
  "pathOutsideRoot",
  "fileNotFound",
  "alreadyExists",
  "ioError",
] as const;

// `entityNotFound` is already part of the domain kinds in TypeScript.
export const SESSION_ERROR_KINDS = ["notWritable", "projectNotOpen"] as const;

// Domain errors that only Rust can produce (TypeScript treats contentPath as opaque).
export const RUST_ONLY_DOMAIN_ERROR_KINDS = [
  "invalidContentExtension",
] as const;

// Produced by this client, never by Rust.
export const CLIENT_ERROR_KINDS = [
  // The command succeeded but its payload does not have the documented shape.
  "invalidCommandResponse",
  // The command failed with something that is not a `{ kind, detail }` error
  // (for example the IPC layer refusing the call).
  "unexpectedCommandError",
] as const;

export const LOAD_ISSUE_KINDS = [
  "unlistedEntity",
  "missingEntity",
  "invalidOrderEntry",
  "duplicateEntityId",
  "entityLoadFailed",
  "missingContent",
  "orphanContent",
  "leftoverTempFile",
  "unrecognizedDirectory",
] as const;

export type LoadIssueKind = (typeof LOAD_ISSUE_KINDS)[number];

export const ENTITY_STATES = ["loaded", "loadFailed"] as const;
export type EntityState = (typeof ENTITY_STATES)[number];
