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

// One cell as the spreadsheet shows it.
export interface SpreadsheetCell {
  readonly text: string;
  // It holds a number (also when shown with a currency sign or `%`).
  readonly number?: boolean;
  // The address of its external link.
  readonly link?: string;
}

// Zero-based worksheet positions, both ends included.
export interface SpreadsheetArea {
  readonly firstRow: number;
  readonly firstColumn: number;
  readonly lastRow: number;
  readonly lastColumn: number;
}

// `rows[0][0]` is the cell at (`firstRow`, `firstColumn`) of the worksheet (zero-based).
export interface SpreadsheetSheet {
  readonly name: string;
  readonly hidden: boolean;
  readonly firstRow: number;
  readonly firstColumn: number;
  readonly rows: readonly (readonly SpreadsheetCell[])[];
  // Zero-based worksheet rows and columns that are hidden.
  readonly hiddenRows: readonly number[];
  readonly hiddenColumns: readonly number[];
  readonly merged: readonly SpreadsheetArea[];
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

// What the app hands Rust to write through the save dialog.
export const EXPORT_FILE_KINDS = ["svg", "png", "html"] as const;
export type ExportFileKind = (typeof EXPORT_FILE_KINDS)[number];

// "Export Documents…": the folder chosen in Rust's dialog, known to the app by a token.
export const EXPORT_FOLDER_STATUS = {
  chosen: "chosen",
  cancelled: "cancelled",
} as const;

export type ExportFolderChoice =
  | {
      readonly status: typeof EXPORT_FOLDER_STATUS.chosen;
      readonly token: string;
      readonly folderName: string;
    }
  | { readonly status: typeof EXPORT_FOLDER_STATUS.cancelled };

// What one Document becomes in the folder.
export const EXPORT_FOLDER_FORMATS = ["md", "html", "pdf"] as const;
export type ExportFolderFormat = (typeof EXPORT_FOLDER_FORMATS)[number];

export interface ExportFolderFile {
  // The Document's name; Rust makes it a safe file name and adds the extension.
  readonly stem: string;
  readonly format: ExportFolderFormat;
  // The folders under the chosen one it goes into, outermost first; [] for none.
  readonly folders: readonly string[];
}

// The largest page of a PDF export in CSS pixels (Linux prints every page this size).
export interface PdfPageExtent {
  readonly width: number;
  readonly height: number;
}

// A file of a Document's `assets/` that nothing in the Document refers to.
export interface UnusedAsset {
  readonly contentPath: string;
  // In bytes.
  readonly size: number;
}

// The unused files of a Document, as the cleanup dialog lists them.
export interface UnusedAssets {
  readonly assets: readonly UnusedAsset[];
  // Unused on disk but named by the undo / redo history (an undo may bring them back):
  // left out of `assets`.
  readonly heldByHistory: number;
}
