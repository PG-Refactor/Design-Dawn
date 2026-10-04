import { LOCAL_STATE_ERROR_KINDS } from "../../application/local-state/local-state-result";
import {
  ASSET_ERROR_KINDS,
  FOLDER_SELECTION_ERROR_KINDS,
  type OperationErrorKind,
  PERSISTENCE_ERROR_KINDS,
  RUST_ONLY_DOMAIN_ERROR_KINDS,
  SESSION_ERROR_KINDS,
} from "../../application/ports/operation-error";
import { DOMAIN_ERROR_KINDS } from "../../domain/shared/domain-error";

// Same kinds the application layer names; one definition, no conversion at the boundary.
export type CommandErrorKind = OperationErrorKind;

export interface CommandError {
  readonly kind: CommandErrorKind;
  // Developer-facing only; callers must compare on `kind`.
  readonly detail: string;
}

export type CommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CommandError };

// Kinds Rust may return; the client-only kinds are excluded so a forged payload cannot
// pose as a client-side failure.
const RUST_ERROR_KINDS: readonly string[] = [
  ...DOMAIN_ERROR_KINDS,
  ...RUST_ONLY_DOMAIN_ERROR_KINDS,
  ...PERSISTENCE_ERROR_KINDS,
  ...SESSION_ERROR_KINDS,
  ...FOLDER_SELECTION_ERROR_KINDS,
  ...ASSET_ERROR_KINDS,
  ...LOCAL_STATE_ERROR_KINDS,
];

// For payloads that carry a Rust error kind (a `loadIssue`), not only a rejection.
export function isRustErrorKind(value: string): value is CommandErrorKind {
  return RUST_ERROR_KINDS.includes(value);
}

export function commandOk<T>(value: T): CommandResult<T> {
  return { ok: true, value };
}

export function commandErr<T = never>(
  kind: CommandErrorKind,
  detail: string,
): CommandResult<T> {
  return { ok: false, error: { kind, detail } };
}

function isRustCommandError(
  value: unknown,
): value is { kind: CommandErrorKind; detail: string } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; detail?: unknown };
  return (
    typeof candidate.kind === "string" &&
    RUST_ERROR_KINDS.includes(candidate.kind) &&
    typeof candidate.detail === "string"
  );
}

function describeUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// TypeScript side of the error conversion boundary:
//   Rust DomainError / PersistenceError -> ApplicationError -> serialized `{ kind, detail }`
//   -> this function -> CommandError.
// A kind missing from RUST_ERROR_KINDS would silently degrade to `unexpectedCommandError`;
// ipc-contract.test.ts compares the list with the identifiers in the Rust source.
// Expected failures arrive as `{ kind, detail }`. Anything else is a bug or an IPC
// level refusal, and is surfaced as a distinct kind instead of being mistaken for one.
export function toCommandError(rejection: unknown): CommandError {
  if (isRustCommandError(rejection)) {
    return { kind: rejection.kind, detail: rejection.detail };
  }
  return {
    kind: "unexpectedCommandError",
    detail: describeUnknown(rejection),
  };
}
