// Results of the asset operations of the persistence port.
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

// The image file dialog (Rust): the chosen files are recorded like a drop, so they are
// imported with `importDroppedImages(dropId, ...)`. Cancelling is an ok result.
export const IMAGE_SELECTION_STATUS = {
  selected: "selected",
  cancelled: "cancelled",
} as const;

export type ImageSelection =
  | {
      readonly status: typeof IMAGE_SELECTION_STATUS.selected;
      readonly dropId: string;
      readonly fileCount: number;
    }
  | { readonly status: typeof IMAGE_SELECTION_STATUS.cancelled };

// "Table from Spreadsheet…": the dialog runs in Rust, which reads the chosen file; only its
// base name and the values come back. Cancelling is an ok result.
export const SPREADSHEET_SELECTION_STATUS = {
  selected: "selected",
  cancelled: "cancelled",
} as const;

export interface SpreadsheetSheet {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
  // Rows or columns beyond Rust's limits were left out.
  readonly truncated: boolean;
}

export type SpreadsheetSelection =
  | {
      readonly status: typeof SPREADSHEET_SELECTION_STATUS.selected;
      readonly fileName: string;
      readonly sheets: readonly SpreadsheetSheet[];
    }
  | { readonly status: typeof SPREADSHEET_SELECTION_STATUS.cancelled };

// An export written through the save dialog (Rust). Only the chosen file's name comes back.
export const EXPORT_STATUS = {
  saved: "saved",
  cancelled: "cancelled",
} as const;

export type ExportOutcome =
  | { readonly status: typeof EXPORT_STATUS.saved; readonly fileName: string }
  | { readonly status: typeof EXPORT_STATUS.cancelled };
