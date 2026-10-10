import { GitDiscardDialog } from "../git/git-discard-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { MoveDialog } from "./move-dialog";
import { NameDialog } from "./name-dialog";
import type { UiState, UnsavedCloseTarget } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import { useUiState } from "./workspace-hooks";
import type { WorkspaceMessages } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";

function unsavedCloseTitle(
  messages: WorkspaceMessages,
  target: UnsavedCloseTarget,
): string {
  const texts = messages.dialogs.confirmUnsavedClose;
  switch (target.kind) {
    case "window":
      return texts.windowTitle;
    case "project":
      return texts.projectTitle;
    case "openProject":
    case "createProject":
      return texts.switchProjectTitle;
    case "document":
      return messages.closeDocumentConfirmationTitle(
        target.name ?? messages.tree.unnamedEntity,
      );
  }
}

const selectDialog = (ui: UiState) => ui.dialog;
const selectBusy = (ui: UiState) => ui.busy;

// Renders the dialog the UI state asks for (at most one) and wires it to the actions.
export function WorkspaceDialogs() {
  const { actions } = useWorkspaceServices();
  const dialog = useUiState(selectDialog);
  const busy = useUiState(selectBusy);
  const messages = useMessages().workspace;
  const texts = messages.dialogs;
  const nameOf = (name: string | null): string =>
    name ?? messages.tree.unnamedEntity;

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
          onSubmit={(name) =>
            void actions.createDocument(name, dialog.parentFolderId)
          }
        />
      );
    case "createFolder":
      return (
        <NameDialog
          title={texts.createFolder.title}
          nameLabel={texts.createFolder.nameLabel}
          submitLabel={texts.createFolder.submit}
          busy={busy}
          onCancel={actions.cancelDialog}
          onSubmit={(name) =>
            void actions.createFolder(name, dialog.parentFolderId)
          }
        />
      );
    case "moveEntry":
      return (
        <MoveDialog
          entryId={dialog.entryId}
          name={nameOf(dialog.name)}
          busy={busy}
          onCancel={actions.cancelDialog}
          onChoose={(target) =>
            void actions.moveEntryTo(dialog.entryId, target)
          }
          onCreateFolder={actions.createFolderForMove}
        />
      );
    case "confirmMoveSave":
      return (
        <ConfirmDialog
          title={messages.moveEntryTitle(nameOf(dialog.name))}
          paragraphs={[texts.confirmMoveSave.body]}
          cancelLabel={texts.cancel}
          confirmLabel={texts.confirmMoveSave.confirm}
          confirmVariant="primary"
          busy={busy}
          onCancel={actions.cancelDialog}
          onConfirm={() => void actions.confirmMoveSave()}
        />
      );
    case "confirmUnsavedClose":
      return (
        <ConfirmDialog
          title={unsavedCloseTitle(messages, dialog.target)}
          paragraphs={[texts.confirmUnsavedClose.body]}
          cancelLabel={texts.cancel}
          confirmLabel={texts.confirmUnsavedClose.save}
          confirmVariant="primary"
          alternative={{
            label: texts.confirmUnsavedClose.discard,
            onSelect: () => void actions.answerUnsavedClose("discard"),
          }}
          busy={busy}
          onCancel={actions.cancelDialog}
          onConfirm={() => void actions.answerUnsavedClose("save")}
        />
      );
    case "confirmDeleteFolder":
      return (
        <ConfirmDialog
          title={messages.deleteConfirmationTitle(nameOf(dialog.name))}
          paragraphs={[texts.undoNotice, texts.deleteFolderConsequence]}
          cancelLabel={texts.cancel}
          confirmLabel={texts.delete}
          busy={busy}
          onCancel={actions.cancelDialog}
          onConfirm={() => void actions.confirmDelete()}
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
          title={messages.deleteConfirmationTitle(nameOf(dialog.name))}
          paragraphs={[texts.undoNotice, texts.deleteDocumentConsequence]}
          cancelLabel={texts.cancel}
          confirmLabel={texts.delete}
          busy={busy}
          onCancel={actions.cancelDialog}
          onConfirm={() => void actions.confirmDelete()}
        />
      );
    case "confirmDiscardGitChanges":
      return (
        <GitDiscardDialog
          targets={dialog.targets}
          documentIds={dialog.documentIds}
          projectFilesAffected={dialog.projectFilesAffected}
          busy={busy}
        />
      );
    case "confirmDeleteSheet":
      return (
        <ConfirmDialog
          title={messages.deleteConfirmationTitle(nameOf(dialog.name))}
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
