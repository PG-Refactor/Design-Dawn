import { useRef } from "react";
import { sheetPanelId, sheetTabId } from "../workspace/tab-ids";
import { selectSheetTabs } from "../workspace/view-models/tabs-model";
import { useWorkspaceModel } from "../workspace/workspace-hooks";
import { MESSAGES } from "../workspace/workspace-messages";
import { Canvas } from "./canvas";
import { CANVAS_MESSAGES } from "./canvas-messages";
import { CanvasToolbar } from "./canvas-toolbar";
import "./canvas.css";

// The tab panel of the active sheet tab; shows the canvas of the active sheet, or an
// empty state when the document has no sheet to show.
export function CanvasPanel() {
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
        ? { "aria-label": MESSAGES.tabs.sheetPanelLabel }
        : { "aria-labelledby": sheetTabId(activeTab.sheetId) })}
    >
      {activeTab === undefined ? (
        <p className="document-panel__empty">{CANVAS_MESSAGES.noSheet}</p>
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
