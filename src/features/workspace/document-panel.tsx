import type { ApplicationState } from "../../application/state/application-state";
import type { DocumentId } from "../../domain/shared/entity-id";
import { CanvasPanel } from "../canvas/canvas-panel";
import { ActiveDocumentBanner } from "../external-change/external-change-banner";
import { SheetTabs } from "./sheet-tabs";
import { documentPanelId, documentTabId } from "./tab-ids";
import type { UiState } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import { useWorkspaceServices } from "./workspace-services-context";

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

// The tab panel of the active document tab: the sheet area with its sheet tabs below it,
// like the sheet tabs of a spreadsheet. Kept apart from the Document tabs at the top, so
// the two rows of tabs are not mistaken for one another.
// Without a Project, the main area says so and offers the two ways to get one (the same
// as the File menu).
function NoProjectPanel() {
  const messages = useMessages().workspace;
  const { actions } = useWorkspaceServices();
  const busy = useUiState((ui) => ui.busy);
  return (
    <div className="document-panel__start">
      <p className="document-panel__empty">{messages.placeholder.noProject}</p>
      <div className="document-panel__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={actions.requestCreateProject}
        >
          {messages.topBar.createProject}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void actions.openProjectViaDialog()}
        >
          {messages.topBar.openProject}
        </button>
      </div>
    </div>
  );
}

export function DocumentPanel() {
  const messages = useMessages().workspace;
  const panel = useWorkspaceModel(selectPanel);
  if (panel.kind === "noProject") return <NoProjectPanel />;
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
      <CanvasPanel />
      <SheetTabs />
    </div>
  );
}
