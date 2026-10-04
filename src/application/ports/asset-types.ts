// Results of the asset operations of the persistence port (docs/architecture.md §6.2).
// They live here so the application layer can name them without importing infrastructure;
// `infrastructure/tauri/asset-types.ts` re-exports them unchanged.

import type { BlockType } from "../../domain/block/block-type";
import type { ContentPath } from "../../domain/block/content-path";
import type { OperationError } from "./operation-error";

// One imported asset with the sizes needed to create its Image Block: the natural size, and
// the initial block size (long edge capped by Rust; the UI minimum is NOT applied to it).
export interface ImportedImage {
  readonly contentPath: ContentPath;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly initialWidth: number;
  readonly initialHeight: number;
  readonly blockType: BlockType;
}

// A dropped file that was not imported; `fileName` is the base name only.
export interface RejectedFile {
  readonly fileName: string;
  readonly error: OperationError;
}

// Partial success is a normal result.
export interface DropImportResult {
  readonly imported: readonly ImportedImage[];
  readonly rejected: readonly RejectedFile[];
}

export interface CopiedAsset {
  readonly contentPath: ContentPath;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}
