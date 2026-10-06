import type { ApplicationState } from "../../application/state/application-state";
import { CanvasPanel } from "../canvas/canvas-panel";
import { SheetTabs } from "./sheet-tabs";
import { documentPanelId, documentTabId } from "./tab-ids";
import type { UiState } from "./ui-state/ui-state";
import { useWorkspaceModel } from "./workspace-hooks";
import { MESSAGES } from "./workspace-messages";

type PanelModel =
  | {
      readonly kind: "document";
      readonly documentId: string;
      readonly tabId: string;
      readonly panelId: string;
    }
  | { readonly kind: "noDocument" }
  | { readonly kind: "noProject" };

function selectPanel(application: ApplicationState, ui: UiState): PanelModel {
  if (application.project === null) return { kind: "noProject" };
  const documentId = ui.activeDocumentId;
  if (documentId === null || !application.documents.has(documentId)) {
    return { kind: "noDocument" };
  }
  return {
    kind: "document",
    documentId,
    tabId: documentTabId(documentId),
    panelId: documentPanelId(documentId),
  };
}

// The tab panel of the active document tab: its sheet tabs and the sheet area.
export function DocumentPanel() {
  const panel = useWorkspaceModel(selectPanel);
  if (panel.kind === "noProject") {
    return (
      <p className="document-panel__empty">{MESSAGES.placeholder.noProject}</p>
    );
  }
  if (panel.kind === "noDocument") {
    return (
      <p className="document-panel__empty">{MESSAGES.placeholder.noDocument}</p>
    );
  }
  return (
    <div
      role="tabpanel"
      id={panel.panelId}
      aria-labelledby={panel.tabId}
      className="document-panel"
    >
      <SheetTabs />
      <CanvasPanel />
    </div>
  );
}
