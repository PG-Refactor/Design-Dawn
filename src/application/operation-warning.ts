import type { ContentPath } from "../domain/block/content-path";
import type { OperationError } from "./ports/operation-error";

export const OPERATION_WARNING_KINDS = {
  // The block was removed from the sheet metadata and saved, but its content file could
  // not be deleted. The command still succeeded; the file stays as an orphan, which the
  // file format tolerates (file-format.md §9) and the loader reports.
  orphanContentFile: "orphanContentFile",
} as const;

export interface OperationWarning {
  readonly kind: (typeof OPERATION_WARNING_KINDS)[keyof typeof OPERATION_WARNING_KINDS];
  readonly contentPath: ContentPath;
  readonly error: OperationError;
}
