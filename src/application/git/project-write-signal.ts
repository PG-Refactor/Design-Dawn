// "The app wrote Project files": lets the Git panel read the status again without being
// asked. The signal carries no data: what changed is
// Git's to say, not ours.

import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { TemplateGateway } from "../ports/template-gateway";

export type ProjectWriteListener = () => void;

export interface ProjectWriteSignal {
  notify(): void;
  subscribe(listener: ProjectWriteListener): () => void;
}

// Rethrown outside the notifying call so it surfaces as an unhandled error.
function rethrowLater(failure: unknown): void {
  queueMicrotask(() => {
    throw failure;
  });
}

export function createProjectWriteSignal(
  reportListenerFailure: (failure: unknown) => void = rethrowLater,
): ProjectWriteSignal {
  const listeners = new Set<{ readonly listener: ProjectWriteListener }>();
  return {
    notify() {
      for (const subscription of [...listeners]) {
        if (!listeners.has(subscription)) continue;
        try {
          subscription.listener();
        } catch (failure) {
          // A faulty subscriber must not break the save that is notifying, but the
          // failure must not vanish either.
          reportListenerFailure(failure);
        }
      }
    },
    subscribe(listener) {
      const subscription = { listener };
      listeners.add(subscription);
      return () => {
        listeners.delete(subscription);
      };
    },
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
    const method = (gateway as unknown as Record<string, GatewayMethod>)[name];
    if (method === undefined) continue;
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
