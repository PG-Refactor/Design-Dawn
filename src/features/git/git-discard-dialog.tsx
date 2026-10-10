import type { ApplicationState } from "../../application/state/application-state";
import type { DocumentId } from "../../domain/shared/entity-id";
import { ConfirmDialog } from "../workspace/confirm-dialog";
import type { DiscardTarget } from "../workspace/ui-state/ui-state";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceModel } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { splitGitPath } from "./git-change-path";
import { confirmGitDiscard } from "./git-discard-flow";

interface GitDiscardDialogProps {
  readonly targets: readonly DiscardTarget[];
  readonly documentIds: readonly DocumentId[];
  readonly projectFilesAffected: boolean;
  readonly busy: boolean;
}

const selectProject = (application: ApplicationState) => application.project;

// The question before Git changes are discarded. Cancel has the initial focus; the texts
// follow VS Code's wording. Names of Documents are looked up now, so they are current.
export function GitDiscardDialog({
  targets,
  documentIds,
  projectFilesAffected,
  busy,
}: GitDiscardDialogProps) {
  const services = useWorkspaceServices();
  const messages = useMessages();
  const texts = messages.git.discardDialog;
  const project = useWorkspaceModel(selectProject);
  const untrackedCount = targets.filter((target) => target.untracked).length;
  const [first] = targets;
  const single = targets.length === 1 && first !== undefined ? first : null;
  const title =
    single === null
      ? texts.multiple(targets.length)
      : single.untracked
        ? texts.singleUntracked(splitGitPath(single.path).name)
        : texts.singleTracked(splitGitPath(single.path).name);
  const paragraphs: string[] = [];
  if (single === null && untrackedCount > 0) {
    paragraphs.push(texts.untrackedNote(untrackedCount));
  }
  paragraphs.push(texts.irreversible);
  if (projectFilesAffected) paragraphs.push(texts.projectFilesNote);
  const documentNames = documentIds.map(
    (documentId) =>
      project?.documents.find((entry) => entry.documentId === documentId)
        ?.name ?? messages.workspace.tree.unnamedEntity,
  );
  if (documentNames.length > 0) paragraphs.push(texts.documentsNote);
  return (
    <ConfirmDialog
      title={title}
      paragraphs={paragraphs}
      listItems={documentNames}
      cancelLabel={messages.workspace.dialogs.cancel}
      confirmLabel={
        single?.untracked === true ? texts.confirmDelete : texts.confirm
      }
      busy={busy}
      onCancel={services.actions.cancelDialog}
      onConfirm={() => void confirmGitDiscard(services)}
    />
  );
}
