// In-memory viewport "file" for tests. Not imported by production code.

import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Viewport } from "../local-state/viewport";
import {
  type OperationError,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { ViewportGateway } from "../ports/viewport-gateway";

export interface ViewportSaveCall {
  readonly projectId: ProjectId;
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly viewport: Viewport;
}

export interface FakeViewportGateway extends ViewportGateway {
  // Saved viewports keyed by `viewportKey`.
  readonly storage: Map<string, Viewport>;
  readonly getCalls: {
    projectId: ProjectId;
    documentId: DocumentId;
    sheetId: SheetId;
  }[];
  readonly saveCalls: ViewportSaveCall[];
  // Returned by every load: the viewport next to this issue is then null.
  loadIssue: OperationError | null;
  failGet: OperationError | null;
  failSave: OperationError | null;
  // Suspends the next `getSheetViewport` until the returned function is called.
  holdNextGet(): () => void;
}

export function viewportKey(
  projectId: ProjectId,
  documentId: DocumentId,
  sheetId: SheetId,
): string {
  return `${projectId}/${documentId}/${sheetId}`;
}

export function createFakeViewportGateway(): FakeViewportGateway {
  let hold: Promise<void> | null = null;
  const storage = new Map<string, Viewport>();
  const gateway: FakeViewportGateway = {
    storage,
    getCalls: [],
    saveCalls: [],
    loadIssue: null,
    failGet: null,
    failSave: null,
    async getSheetViewport(projectId, documentId, sheetId) {
      gateway.getCalls.push({ projectId, documentId, sheetId });
      const pending = hold;
      hold = null;
      if (pending !== null) await pending;
      if (gateway.failGet !== null) {
        return operationErr(gateway.failGet.kind, gateway.failGet.detail);
      }
      return operationOk({
        viewport:
          storage.get(viewportKey(projectId, documentId, sheetId)) ?? null,
        loadIssue: gateway.loadIssue,
      });
    },
    async saveSheetViewport(projectId, documentId, sheetId, viewport) {
      gateway.saveCalls.push({ projectId, documentId, sheetId, viewport });
      if (gateway.failSave !== null) {
        return operationErr(gateway.failSave.kind, gateway.failSave.detail);
      }
      storage.set(viewportKey(projectId, documentId, sheetId), viewport);
      return operationOk(undefined);
    },
    holdNextGet() {
      let release: () => void = () => {};
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
  return gateway;
}
