import { useId, useRef, useState } from "react";
import type { OperationResult } from "../../application/ports/operation-error";
import type { EntryId, FolderId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { Modal } from "./modal";
import { MoveTargetTree } from "./move-target-tree";
import { useMessages } from "./use-messages";
import {
  canCreateFolderIn,
  MOVE_TARGET_ROOT_KEY,
  type MoveTarget,
  moveTargetKey,
  selectMoveTargets,
  visibleMoveTargets,
} from "./view-models/move-targets";
import { useWorkspaceServices } from "./workspace-services-context";

export interface MoveDialogProps {
  readonly entryId: EntryId;
  readonly name: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  // null = the Project root.
  readonly onChoose: (targetParentFolderId: FolderId | null) => void;
  // Creates the folder inside `parentFolderId` right away (it is not part of the move and
  // stays if the move is cancelled).
  readonly onCreateFolder: (
    parentFolderId: FolderId | null,
    name: string,
  ) => Promise<OperationResult<FolderId>>;
}

const identity = <Value,>(value: Value): Value => value;

// Picks where an entry goes, in a tree like the Project Tree. Every folder stays listed;
// the ones that cannot be chosen are disabled and say why (the current parent is disabled
// because moving there would change nothing). Everything starts expanded so the current
// parent and every other target are visible without clicking; folding is local to the
// dialog. A click highlights a row; "Move Here", Enter or a double-click moves there.
export function MoveDialog({
  entryId,
  name,
  busy,
  onCancel,
  onChoose,
  onCreateFolder,
}: MoveDialogProps) {
  const messages = useMessages().workspace;
  const { applicationStore } = useWorkspaceServices();
  const application = useStoreSelector(applicationStore, identity);
  const targets = selectMoveTargets(application, entryId);
  const titleId = useId();
  const descriptionId = useId();
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        selectMoveTargets(application, entryId)
          .filter((target) => target.hasChildFolders)
          .map((target) => target.key),
      ),
  );
  const [initialKey] = useState(
    () =>
      targets.find((target) => target.disabledReason === null)?.key ??
      MOVE_TARGET_ROOT_KEY,
  );
  const [highlightedKey, setHighlightedKey] = useState(initialKey);
  const [creatingInKey, setCreatingInKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const rows = visibleMoveTargets(targets, expandedKeys);
  const highlighted = targets.find((target) => target.key === highlightedKey);
  const canChoose =
    highlighted !== undefined && highlighted.disabledReason === null;
  const canCreate = highlighted !== undefined && canCreateFolderIn(highlighted);

  function setExpanded(key: string, expanded: boolean): void {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function choose(target: MoveTarget): void {
    if (busy || target.disabledReason !== null) return;
    onChoose(target.parentFolderId);
  }

  function startCreating(): void {
    if (highlighted === undefined || !canCreate) return;
    setExpanded(highlighted.key, true);
    setCreatingInKey(highlighted.key);
  }

  async function createFolder(
    folderName: string,
    parentKey: string,
  ): Promise<void> {
    setCreatingInKey(null);
    const parent = targets.find((target) => target.key === parentKey);
    if (parent === undefined) return;
    const created = await onCreateFolder(parent.parentFolderId, folderName);
    if (!created.ok) return;
    // The new folder becomes the highlighted target.
    const createdKey = moveTargetKey(created.value);
    setHighlightedKey(createdKey);
    setFocusKey(createdKey);
  }

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={onCancel}
      initialFocusRef={initialFocusRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {messages.moveEntryTitle(name)}
      </h2>
      <p id={descriptionId} className="modal__body">
        {messages.dialogs.moveEntry.description}
      </p>
      <MoveTargetTree
        rows={rows}
        label={messages.dialogs.moveEntry.listLabel}
        highlightedKey={highlightedKey}
        expandedKeys={expandedKeys}
        creatingInKey={creatingInKey}
        initialFocusRef={initialFocusRef}
        initialKey={initialKey}
        focusKey={focusKey}
        onHighlight={setHighlightedKey}
        onSetExpanded={setExpanded}
        onChoose={choose}
        onCreateFolder={(folderName, parentKey) =>
          void createFolder(folderName, parentKey)
        }
        onCancelCreate={() => setCreatingInKey(null)}
      />
      <div className="modal__actions">
        <button
          type="button"
          className="button"
          disabled={busy || !canCreate || creatingInKey !== null}
          onClick={startCreating}
        >
          {messages.dialogs.moveEntry.newFolder}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onCancel}
        >
          {messages.dialogs.cancel}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !canChoose}
          onClick={() => {
            if (highlighted !== undefined) choose(highlighted);
          }}
        >
          {messages.dialogs.moveEntry.choose}
        </button>
      </div>
    </Modal>
  );
}
