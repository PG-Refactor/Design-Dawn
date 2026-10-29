import type { ApplicationState } from "../../application/state/application-state";
import type { DocumentId } from "../../domain/shared/entity-id";
import { CanvasPanel } from "../canvas/canvas-panel";
import { ActiveDocumentBanner } from "../external-change/external-change-banner";
import { SheetTabs } from "./sheet-tabs";
import { documentPanelId, documentTabId } from "./tab-ids";
import type { UiState } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import { useWorkspaceModel } from "./workspace-hooks";

type PanelModel =
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
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
  const messages = useMessages().workspace;
  const panel = useWorkspaceModel(selectPanel);
  if (panel.kind === "noProject") {
    return (
      <p className="document-panel__empty">{messages.placeholder.noProject}</p>
    );
  }
  if (panel.kind === "noDocument") {
    return (
      <p className="document-panel__empty">{messages.placeholder.noDocument}</p>
    );
  }
  return (
    <div
      role="tabpanel"
      id={panel.panelId}
      aria-labelledby={panel.tabId}
      className="document-panel"
    >
      <ActiveDocumentBanner documentId={panel.documentId} />
      <SheetTabs />
      <CanvasPanel />
    </div>
  );
}
