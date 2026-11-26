// "The app wrote Project files": lets the Git panel read the status again without being
// asked. The signal carries no data: what changed is
// Git's to say, not ours.

import { createListenerSet } from "../listener-set";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { TemplateGateway } from "../ports/template-gateway";

export type ProjectWriteListener = () => void;

export interface ProjectWriteSignal {
  notify(): void;
  subscribe(listener: ProjectWriteListener): () => void;
}

export function createProjectWriteSignal(
  reportListenerFailure?: (failure: unknown) => void,
): ProjectWriteSignal {
  const listeners = createListenerSet<void>(reportListenerFailure);
  return {
    notify: () => listeners.notify(),
    subscribe: listeners.subscribe,
  };
}

// Every gateway method is listed, so adding one to the port fails to compile until it is
// decided whether it writes Project files.
export const GATEWAY_METHOD_KINDS = {
  selectProjectFolder: "read",
  openProject: "read",
  reloadProject: "read",
  checkExternalChanges: "read",
  acceptDiskState: "read",
  compareBlockContent: "read",
  repairLoadIssue: "write",
  updateOutdatedFiles: "write",
  openProjectInNewWindow: "read",
  takeOpenRequest: "read",
  closeProject: "read",
  createProject: "read",
  saveProject: "write",
  createDocument: "write",
  createFolder: "write",
  saveFolder: "write",
  moveEntry: "write",
  deleteFolder: "write",
  loadDocument: "read",
  closeDocument: "read",
  createSheet: "write",
  // Only picks a directory name; the first write into the sheet writes.
  reserveSheet: "read",
  deleteSheet: "write",
  deleteDocument: "write",
  saveSheet: "write",
  saveDocument: "write",
  createBlockContent: "write",
  readBlockContent: "read",
  writeBlockContent: "write",
  deleteBlockContent: "write",
  restoreBlockContent: "write",
  // Only picks a name; nothing is written.
  reserveBlockContent: "read",
  // Only records the chosen files (like a drop); the import writes.
  selectImageFiles: "read",
  // App settings, not Project files.
  defaultProjectLocation: "read",
  setDefaultProjectLocation: "read",
  importDroppedImages: "write",
  importPastedImage: "write",
  // Reads a file outside the Project; the blocks it becomes are written by a command.
  readSpreadsheetViaDialog: "read",
  searchProject: "read",
  // Writes outside the Project only.
  exportDocumentMarkdown: "read",
  exportFile: "read",
  chooseExportFolder: "read",
  exportFolderExisting: "read",
  exportMarkdownIntoFolder: "read",
  exportHtmlIntoFolder: "read",
  exportPdfIntoFolder: "read",
  exportPdfFile: "read",
  openPrintWindow: "read",
  printWindowsOpen: "read",
  closePrintWindows: "read",
  setPrintWindowsHidden: "read",
  assetDataUrl: "read",
  copyAssetToDocument: "write",
  listUnusedAssets: "read",
  deleteUnusedAssets: "write",
} as const satisfies Record<keyof PersistenceGateway, "write" | "read">;

type GatewayMethod = (...args: unknown[]) => Promise<unknown>;

// The template commands that may write files of the Project: a shared template lives in
// its `templates/` (saving, renaming, deleting, moving, an edit written back), and making
// something from a template copies images into a Document.
export const TEMPLATE_GATEWAY_METHOD_KINDS = {
  listTemplates: "read",
  readTemplate: "read",
  saveTemplate: "write",
  renameTemplate: "write",
  deleteTemplate: "write",
  moveTemplate: "write",
  openTemplateEditor: "read",
  templateEditInfo: "read",
  importTemplateEditAsset: "read",
  saveTemplateEdit: "write",
  importTemplateAsset: "write",
} as const satisfies Record<keyof TemplateGateway, "write" | "read">;

// Forwards every call unchanged and notifies once a writing call has settled. A failed
// write notifies too: it may have changed files before it failed. Opening a Project is not
// a write here, because the Git state already refreshes when a Project is installed.
function decorateWrites<Gateway extends object>(
  gateway: Gateway,
  kinds: Readonly<Record<keyof Gateway, "write" | "read">>,
  signal: ProjectWriteSignal,
): Gateway {
  const decorated: Record<string, GatewayMethod> = {};
  for (const [name, kind] of Object.entries(kinds)) {
    // `kinds` lists exactly the methods of the gateway.
    const method = (gateway as unknown as Record<string, GatewayMethod>)[
      name
    ] as GatewayMethod;
    decorated[name] =
      kind === "write"
        ? async (...args) => {
            try {
              return await method.apply(gateway, args);
            } finally {
              signal.notify();
            }
          }
        : (...args) => method.apply(gateway, args);
  }
  return decorated as unknown as Gateway;
}

export function withWriteSignal(
  gateway: PersistenceGateway,
  signal: ProjectWriteSignal,
): PersistenceGateway {
  return decorateWrites(gateway, GATEWAY_METHOD_KINDS, signal);
}

export function withTemplateWriteSignal(
  gateway: TemplateGateway,
  signal: ProjectWriteSignal,
): TemplateGateway {
  return decorateWrites(gateway, TEMPLATE_GATEWAY_METHOD_KINDS, signal);
}
