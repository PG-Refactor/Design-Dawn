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
] as const;

// `entityNotFound` is already part of the domain kinds in TypeScript.
export const SESSION_ERROR_KINDS = ["notWritable", "projectNotOpen"] as const;

// Folder selection (docs/architecture.md §6.2.2): the dialog failed, or a selectionId is
// unknown / replaced by a newer selection. Cancelling is a result, not an error.
export const FOLDER_SELECTION_ERROR_KINDS = [
  "dialogFailed",
  "invalidFolderSelection",
] as const;

// Image assets (docs/file-format.md §6): a dropped file or asset whose content is not a
// valid image, one over the size limit, and a `dropId` that is unknown or replaced by a
// newer drop (the same pattern as `invalidFolderSelection`).
export const ASSET_ERROR_KINDS = [
  "invalidImageContent",
  "assetTooLarge",
  "invalidDropSelection",
] as const;

// Domain errors that only Rust can produce (TypeScript treats contentPath as opaque).
export const RUST_ONLY_DOMAIN_ERROR_KINDS = [
  "invalidContentExtension",
] as const;

// Produced by the client, never by Rust.
export const CLIENT_ERROR_KINDS = [
  // The command succeeded but its payload does not have the documented shape.
  "invalidCommandResponse",
  // The command failed with something that is not a `{ kind, detail }` error
  // (for example the IPC layer refusing the call).
  "unexpectedCommandError",
] as const;

export type OperationErrorKind =
  | DomainErrorKind
  | (typeof RUST_ONLY_DOMAIN_ERROR_KINDS)[number]
  | (typeof PERSISTENCE_ERROR_KINDS)[number]
  | (typeof SESSION_ERROR_KINDS)[number]
  | (typeof FOLDER_SELECTION_ERROR_KINDS)[number]
  | (typeof ASSET_ERROR_KINDS)[number]
  | (typeof LOCAL_STATE_ERROR_KINDS)[number]
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
