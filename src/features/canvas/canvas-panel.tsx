import { sheetPanelId, sheetTabId } from "../workspace/tab-ids";
import { selectSheetTabs } from "../workspace/view-models/tabs-model";
import { useWorkspaceModel } from "../workspace/workspace-hooks";
import { MESSAGES } from "../workspace/workspace-messages";
import { Canvas } from "./canvas";
import { CANVAS_MESSAGES } from "./canvas-messages";
import "./canvas.css";

// The tab panel of the active sheet tab; shows the canvas of the active sheet, or an
// empty state when the document has no sheet to show.
export function CanvasPanel() {
  const model = useWorkspaceModel(selectSheetTabs);
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
        <Canvas
          key={activeTab.sheetId}
          documentId={model.documentId}
          sheetId={activeTab.sheetId}
          sheetName={activeTab.name}
        />
      )}
    </div>
  );
}
