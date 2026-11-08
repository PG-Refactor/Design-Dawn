import { useRef } from "react";
import { sheetPanelId, sheetTabId } from "../workspace/tab-ids";
import { useMessages } from "../workspace/use-messages";
import { selectSheetTabs } from "../workspace/view-models/tabs-model";
import { useUiState, useWorkspaceModel } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { Canvas } from "./canvas";
import { CanvasToolbar } from "./canvas-toolbar";
import "./canvas.css";

// The tab panel of the active sheet tab; shows the canvas of the active sheet, or an
// empty state when the document has no sheet to show.
export function CanvasPanel() {
  const messages = useMessages();
  const { actions } = useWorkspaceServices();
  const busy = useUiState((ui) => ui.busy);
  const model = useWorkspaceModel(selectSheetTabs);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  if (model === null) return null;
  const activeTab = model.tabs.find((tab) => tab.isActive);
  return (
    <div
      role="tabpanel"
      id={sheetPanelId(model.documentId)}
      className="canvas-panel"
      {...(activeTab === undefined
        ? { "aria-label": messages.workspace.tabs.sheetPanelLabel }
        : { "aria-labelledby": sheetTabId(activeTab.sheetId) })}
    >
      {activeTab === undefined ? (
        <div className="document-panel__start">
          <p className="document-panel__empty">{messages.canvas.noSheet}</p>
          <div className="document-panel__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void actions.requestCreateSheet(model.documentId)}
            >
              {messages.workspace.tabs.createSheet}
            </button>
          </div>
        </div>
      ) : (
        <>
          <CanvasToolbar
            documentId={model.documentId}
            sheetId={activeTab.sheetId}
            measureCanvas={() => {
              const rect = canvasHostRef.current?.getBoundingClientRect();
              return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
            }}
          />
          <div ref={canvasHostRef} className="canvas-panel__canvas">
            <Canvas
              key={activeTab.sheetId}
              documentId={model.documentId}
              sheetId={activeTab.sheetId}
              sheetName={activeTab.name}
            />
          </div>
        </>
      )}
    </div>
  );
}
