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
  // A text edit set (src/domain/diagram/text-edit.ts) that cannot be applied: an offset
  // outside the text or inside a surrogate pair, edits that overlap, or two inserts at the
  // same offset whose order would be a hidden rule.
  "invalidTextEdit",
  "overlappingTextEdits",
  "ambiguousTextEdits",
  // The text a GUI computed its edits against is no longer the block's current text.
  "staleContent",
  // Diagram operations (src/domain/diagram/, src/application/diagram/): the source cannot be
  // edited by the GUI (`diagramNotEditable`), the operation itself is refused
  // (`invalidDiagramOperation`), the candidate's meaning differs from what the operation
  // promised (`diagramMeaningMismatch`), or Mermaid cannot draw the candidate
  // (`diagramRenderRejected`). The reason code is the first word of `detail`.
  "diagramNotEditable",
  "invalidDiagramOperation",
  "diagramMeaningMismatch",
  "diagramRenderRejected",
] as const;

export type DomainErrorKind =
  | (typeof DOMAIN_ERROR_KINDS)[number]
  | (typeof TS_ONLY_DOMAIN_ERROR_KINDS)[number];

export interface DomainError {
  readonly kind: DomainErrorKind;
  // Developer-facing only; callers must compare on `kind`.
  readonly detail: string;
}
