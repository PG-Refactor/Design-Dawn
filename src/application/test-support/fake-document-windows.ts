// Fake windows of one Project: what Rust does between them (keeping hand-overs until their
// window takes them, telling the receiving window), over one fake disk shared by every
// workspace like Rust's one session. Not imported by production code.

import type { DocumentId } from "../../domain/shared/entity-id";
import type {
  DocumentWindowGateway,
  DocumentWindowTarget,
} from "../ports/document-window-gateway";
import { operationErr, operationOk } from "../ports/operation-error";
import type { FakeGateway } from "./fakes";

export interface SentDocument {
  readonly from: string;
  readonly documentId: DocumentId;
  readonly target: DocumentWindowTarget;
  readonly transferId: string;
}

export interface FakeDocumentWindows {
  // The gateway of the window `label`.
  gatewayFor(label: string): DocumentWindowGateway;
  // Every successful move, in order.
  readonly sent: SentDocument[];
  // Every name a window showed for a Document it holds, in order.
  readonly shownNames: {
    readonly documentId: DocumentId;
    readonly name: string;
  }[];
  // The next move fails (like a window that could not be created).
  failNextTransfer(): void;
  // What `projectWindowAt` answers (default: no window there).
  setWindowAtPoint(label: string | null): void;
  // What `listProjectWindows` answers (seen from each window: `isSelf` is set per caller).
  setWindows(
    windows: readonly {
      readonly label: string;
      readonly role: "project" | "document";
    }[],
  ): void;
}

export function createFakeDocumentWindows(
  disk: FakeGateway,
): FakeDocumentWindows {
  const waiting = new Map<string, { to: string; payload: string }>();
  const sent: SentDocument[] = [];
  const shownNames: { documentId: DocumentId; name: string }[] = [];
  let failNext = false;
  let nextId = 1;
  let nextWindow = 1;
  let windowAtPoint: string | null = null;
  let listed: readonly {
    readonly label: string;
    readonly role: "project" | "document";
  }[] = [];
  return {
    sent,
    shownNames,
    setWindows(windows) {
      listed = windows;
    },
    setWindowAtPoint(label) {
      windowAtPoint = label;
    },
    failNextTransfer() {
      failNext = true;
    },
    gatewayFor(label) {
      return {
        async transferDocument(_projectId, documentId, payload, target) {
          if (failNext) {
            failNext = false;
            return operationErr("ioError", "the window could not be created");
          }
          const transferId = `transfer-${nextId++}`;
          const to =
            target.kind === "window"
              ? target.label
              : `window-new-${nextWindow++}`;
          waiting.set(transferId, { to, payload });
          sent.push({ from: label, documentId, target, transferId });
          return operationOk(undefined);
        },
        async takeDocumentTransfer(transferId) {
          const found = waiting.get(transferId);
          if (found === undefined || found.to !== label) {
            return operationErr(
              "invalidDocumentTransfer",
              "not for this window",
            );
          }
          waiting.delete(transferId);
          return operationOk(found.payload);
        },
        async getProjectSnapshot() {
          return operationOk(disk.peekProjectSnapshot());
        },
        async projectWindowAt() {
          return operationOk(windowAtPoint);
        },
        async showDocumentName(_projectId, documentId, name) {
          shownNames.push({ documentId, name });
          return operationOk(undefined);
        },
        async listProjectWindows() {
          return operationOk(
            listed.map((window) => ({
              ...window,
              isSelf: window.label === label,
              documentIds: [],
            })),
          );
        },
      };
    },
  };
}
