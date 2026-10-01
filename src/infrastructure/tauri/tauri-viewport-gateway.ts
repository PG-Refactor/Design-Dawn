import type { ViewportGateway } from "../../application/ports/viewport-gateway";
import { getSheetViewport, saveSheetViewport } from "./local-state-client";

// `CommandResult` and `OperationResult` share one shape, so only the save result (null on
// the wire) needs adapting to `void`.
export function createTauriViewportGateway(): ViewportGateway {
  return {
    getSheetViewport,
    async saveSheetViewport(projectId, documentId, sheetId, viewport) {
      const result = await saveSheetViewport(
        projectId,
        documentId,
        sheetId,
        viewport,
      );
      return result.ok ? { ok: true, value: undefined } : result;
    },
  };
}
