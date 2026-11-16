// The formats of "Export ▸", in menu order, and their menu labels.

import {
  EXPORT_FOLDER_FORMATS,
  type ExportFolderFormat,
} from "../../application/ports/asset-types";
import type { ExportMessages } from "./export-messages";

export const EXPORT_FORMATS: readonly ExportFolderFormat[] =
  EXPORT_FOLDER_FORMATS;

export function exportItemLabel(
  messages: ExportMessages,
  format: ExportFolderFormat,
): string {
  switch (format) {
    case "md":
      return messages.exportMarkdownItem;
    case "html":
      return messages.exportHtmlItem;
    case "pdf":
      return messages.exportPdfItem;
  }
}
