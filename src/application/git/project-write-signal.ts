// "The app wrote Project files": lets the Git panel read the status again without being
// asked (docs/git-development.md §11.15). The signal carries no data: what changed is
// Git's to say, not ours.

import type { PersistenceGateway } from "../ports/persistence-gateway";

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
  importDroppedImages: "write",
  copyAssetToDocument: "write",
} as const satisfies Record<keyof PersistenceGateway, "write" | "read">;

type GatewayMethod = (...args: unknown[]) => Promise<unknown>;

// Forwards every call unchanged and notifies once a writing call has settled. A failed
// write notifies too: it may have changed files before it failed. Opening a Project is not
// a write here, because the Git state already refreshes when a Project is installed.
export function withWriteSignal(
  gateway: PersistenceGateway,
  signal: ProjectWriteSignal,
): PersistenceGateway {
  const decorated: Record<string, GatewayMethod> = {};
  for (const [name, kind] of Object.entries(GATEWAY_METHOD_KINDS)) {
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
  return decorated as unknown as PersistenceGateway;
}
