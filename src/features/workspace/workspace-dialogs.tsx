import { ConfirmDialog } from "./confirm-dialog";
import { NameDialog } from "./name-dialog";
import type { UiState } from "./ui-state/ui-state";
import { useUiState } from "./workspace-hooks";
import { deleteConfirmationTitle, MESSAGES } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";

const selectDialog = (ui: UiState) => ui.dialog;
const selectBusy = (ui: UiState) => ui.busy;

// Renders the dialog the UI state asks for (at most one) and wires it to the actions.
export function WorkspaceDialogs() {
  const { actions } = useWorkspaceServices();
  const dialog = useUiState(selectDialog);
  const busy = useUiState(selectBusy);
  const texts = MESSAGES.dialogs;

  switch (dialog.kind) {
    case "none":
      return null;
    case "createProject":
      return (
        <NameDialog
          title={texts.createProject.title}
          nameLabel={texts.createProject.nameLabel}
          submitLabel={texts.createProject.submit}
          busy={busy}
          onCancel={actions.cancelDialog}
          onSubmit={(name) => void actions.createProjectViaDialog(name)}
        />
      );
    case "createDocument":
      return (
        <NameDialog
          title={texts.createDocument.title}
          nameLabel={texts.createDocument.nameLabel}
          submitLabel={texts.createDocument.submit}
          busy={busy}
          onCancel={actions.cancelDialog}
          onSubmit={(name) => void actions.createDocument(name)}
        />
      );
    case "createSheet": {
      const { documentId } = dialog;
      return (
        <NameDialog
          title={texts.createSheet.title}
          nameLabel={texts.createSheet.nameLabel}
          submitLabel={texts.createSheet.submit}
          busy={busy}
          onCancel={actions.cancelDialog}
          onSubmit={(name) => void actions.createSheet(documentId, name)}
        />
      );
    }
    case "confirmDeleteDocument":
      return (
        <ConfirmDialog
          title={deleteConfirmationTitle(dialog.name)}
          paragraphs={[texts.undoNotice, texts.deleteDocumentConsequence]}
          cancelLabel={texts.cancel}
          confirmLabel={texts.delete}
          busy={busy}
          onCancel={actions.cancelDialog}
          onConfirm={() => void actions.confirmDelete()}
        />
      );
    case "confirmDeleteSheet":
      return (
        <ConfirmDialog
          title={deleteConfirmationTitle(dialog.name)}
          paragraphs={[texts.undoNotice]}
          cancelLabel={texts.cancel}
          confirmLabel={texts.delete}
          busy={busy}
          onCancel={actions.cancelDialog}
          onConfirm={() => void actions.confirmDelete()}
        />
      );
  }
}
