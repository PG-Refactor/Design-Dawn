// Error kinds and the result type shared by every application operation and port.
//
// The kind lists below are the single definition of the identifiers Rust and the client
// can report. They live here (not in infrastructure) so the application layer can name
// them; `infrastructure/tauri/command-constants.ts` re-exports them unchanged and
// `ipc-contract.test.ts` still compares them with the Rust source.

import type { DomainErrorKind } from "../../domain/shared/domain-error";
import type { DomainResult } from "../../domain/shared/domain-result";
import type { LOCAL_STATE_ERROR_KINDS } from "../local-state/local-state-result";

export const PERSISTENCE_ERROR_KINDS = [
  "invalidJson",
  "invalidFileStructure",
  "invalidEncoding",
  "pathOutsideRoot",
  "fileNotFound",
  "alreadyExists",
  "ioError",
  // The file changed (or was removed) outside the app since the app last read or wrote it,
  // so a save would discard that change.
  "externallyModified",
] as const;

// `entityNotFound` is already part of the domain kinds in TypeScript.
// `projectOpenInOtherWindow`: the Project is open in another window, which Rust brought
// to the front instead of opening it here.
export const SESSION_ERROR_KINDS = [
  "notWritable",
  "projectNotOpen",
  "projectOpenInOtherWindow",
] as const;

// Folder selection: the dialog failed, or a selectionId is
// unknown / replaced by a newer selection. Cancelling is a result, not an error.
export const FOLDER_SELECTION_ERROR_KINDS = [
  "dialogFailed",
  "invalidFolderSelection",
] as const;

// Image assets: a dropped file or asset whose content is not a
// valid image, one over the size limit, and a `dropId` that is unknown or replaced by a
// newer drop (the same pattern as `invalidFolderSelection`).
export const ASSET_ERROR_KINDS = [
  "invalidImageContent",
  "assetTooLarge",
  "invalidDropSelection",
] as const;

// Folder commands: deleting a folder that still holds
// something, and a move that is not allowed (into itself or a descendant, or an open entry).
export const FOLDER_ERROR_KINDS = ["folderNotEmpty", "invalidMove"] as const;

// Git: a git process that failed or timed out, and a
// Project-relative path git must not receive. "No repository" / "git missing" are states of
// the Git status, not error kinds.
export const GIT_ERROR_KINDS = [
  "gitCommandFailed",
  "gitTimeout",
  "invalidGitPath",
  "gitNotReady",
  // Commit.
  "invalidCommitMessage",
  "nothingToCommit",
  "gitUnmergedChanges",
  "gitOperationInProgress",
  "gitIdentityMissing",
  "gitCommitRejected",
  // History.
  "invalidHistoryRequest",
  // Discard.
  "gitDiscardRejected",
  // Commit options and Undo Last Commit.
  "gitNoCommitToAmend",
  "gitCommitAlreadyPushed",
  "gitCannotUndoCommit",
  // Remote operations.
  "gitNoRemote",
  "gitNoUpstream",
  "gitDetachedHead",
  "gitRemoteNotFound",
  "gitAuthenticationFailed",
  "gitNetworkUnavailable",
  "gitPushRejected",
  "gitPullConflicts",
  "gitPullBlockedByLocalChanges",
] as const;

// Domain errors that only Rust can produce (TypeScript treats contentPath as opaque).
export const RUST_ONLY_DOMAIN_ERROR_KINDS = [
  "invalidContentExtension",
] as const;

// The app itself refuses to save a Document whose files changed outside the app until the
// user decides what to do. Produced by the application layer,
// never by Rust (Rust's own last-line refusal is `externallyModified`).
export const EXTERNAL_CHANGE_ERROR_KINDS = ["externalConflict"] as const;

// Produced by the client, never by Rust.
export const CLIENT_ERROR_KINDS = [
  // The command succeeded but its payload does not have the documented shape.
  "invalidCommandResponse",
  // The command failed with something that is not a `{ kind, detail }` error
  // (for example the IPC layer refusing the call).
  "unexpectedCommandError",
  // A document handed over by another window that cannot be taken in (another version of
  // the payload, or values that are not what the app writes).
  "invalidDocumentTransfer",
] as const;

export type OperationErrorKind =
  | DomainErrorKind
  | (typeof RUST_ONLY_DOMAIN_ERROR_KINDS)[number]
  | (typeof PERSISTENCE_ERROR_KINDS)[number]
  | (typeof SESSION_ERROR_KINDS)[number]
  | (typeof FOLDER_SELECTION_ERROR_KINDS)[number]
  | (typeof ASSET_ERROR_KINDS)[number]
  | (typeof FOLDER_ERROR_KINDS)[number]
  | (typeof GIT_ERROR_KINDS)[number]
  | (typeof LOCAL_STATE_ERROR_KINDS)[number]
  | (typeof EXTERNAL_CHANGE_ERROR_KINDS)[number]
  | (typeof CLIENT_ERROR_KINDS)[number];

export interface OperationError {
  readonly kind: OperationErrorKind;
  // Developer-facing only; callers must compare on `kind`.
  readonly detail: string;
}

export type OperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: OperationError };

export function operationOk<T>(value: T): OperationResult<T> {
  return { ok: true, value };
}

export function operationErr<T = never>(
  kind: OperationErrorKind,
  detail: string,
): OperationResult<T> {
  return { ok: false, error: { kind, detail } };
}

export function failWith<T = never>(error: OperationError): OperationResult<T> {
  return { ok: false, error };
}

export function fromDomainResult<T>(
  result: DomainResult<T>,
): OperationResult<T> {
  return result.ok ? operationOk(result.value) : failWith(result.error);
}

export function mapOperationResult<T, U>(
  result: OperationResult<T>,
  convert: (value: T) => U,
): OperationResult<U> {
  return result.ok ? operationOk(convert(result.value)) : result;
}
