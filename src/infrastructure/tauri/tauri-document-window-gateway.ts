import type { DocumentWindowGateway } from "../../application/ports/document-window-gateway";
import { COMMANDS } from "./command-constants";
import { commandOk } from "./command-error";
import { call } from "./invoke-command";
import {
  toOptionalWindowLabel,
  toProjectSnapshotResult,
  toProjectWindows,
  toTransferPayload,
} from "./persistence-payloads";

// Thin: maps the port onto the Rust commands of the Project's windows.
export function createTauriDocumentWindowGateway(): DocumentWindowGateway {
  return {
    transferDocument: (projectId, documentId, payload, target) =>
      call(
        COMMANDS.transferDocument,
        {
          projectId,
          documentId,
          payload,
          target:
            target.kind === "window"
              ? { kind: "window", label: target.label }
              : {
                  kind: "newWindow",
                  screenX: target.screenX,
                  screenY: target.screenY,
                },
        },
        () => commandOk(undefined),
      ),
    takeDocumentTransfer: (transferId) =>
      call(COMMANDS.takeDocumentTransfer, { transferId }, toTransferPayload),
    getProjectSnapshot: (projectId) =>
      call(COMMANDS.getProjectSnapshot, { projectId }, toProjectSnapshotResult),
    listProjectWindows: (projectId) =>
      call(COMMANDS.listProjectWindows, { projectId }, toProjectWindows),
    projectWindowAt: (projectId, screenX, screenY) =>
      call(
        COMMANDS.projectWindowAt,
        { projectId, screenX, screenY },
        toOptionalWindowLabel,
      ),
  };
}
