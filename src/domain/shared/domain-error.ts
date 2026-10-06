// Identifiers are shared with Rust (DomainErrorKind::as_str). `invalidContentExtension`
// is Rust-only because TypeScript treats contentPath as opaque, so it is omitted here.
export const DOMAIN_ERROR_KINDS = [
  "invalidEntityId",
  "invalidDisplayName",
  "invalidPosition",
  "invalidSize",
  "unsupportedBlockType",
  "invalidContentPath",
  "invalidSchemaVersion",
  "unsupportedSchemaVersion",
  "duplicateId",
  "entityNotFound",
] as const;

// Produced only by TypeScript domain operations (Rust has no domain operations yet), so
// these are never sent by Rust and are kept out of the list compared with the Rust source.
export const TS_ONLY_DOMAIN_ERROR_KINDS = [
  // A z-order index given to a block re-insertion is out of range or used twice.
  "invalidBlockIndex",
] as const;

export type DomainErrorKind =
  | (typeof DOMAIN_ERROR_KINDS)[number]
  | (typeof TS_ONLY_DOMAIN_ERROR_KINDS)[number];

export interface DomainError {
  readonly kind: DomainErrorKind;
  // Developer-facing only; callers must compare on `kind`.
  readonly detail: string;
}
