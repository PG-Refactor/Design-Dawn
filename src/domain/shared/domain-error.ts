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

export type DomainErrorKind = (typeof DOMAIN_ERROR_KINDS)[number];

export interface DomainError {
  readonly kind: DomainErrorKind;
  // Developer-facing only; callers must compare on `kind`.
  readonly detail: string;
}
