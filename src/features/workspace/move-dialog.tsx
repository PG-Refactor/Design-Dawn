import { type CSSProperties, useId, useRef } from "react";
import type { EntryId, FolderId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { Modal } from "./modal";
import {
  type MoveTarget,
  type MoveTargetDisabledReason,
  selectMoveTargets,
} from "./view-models/move-targets";
import { MESSAGES } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./move-dialog.css";

export interface MoveDialogProps {
  readonly entryId: EntryId;
  readonly name: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  // null = the Project root.
  readonly onChoose: (targetParentFolderId: FolderId | null) => void;
}

const identity = <Value,>(value: Value): Value => value;

function disabledHint(reason: MoveTargetDisabledReason): string {
  switch (reason) {
    case "currentParent":
      return MESSAGES.dialogs.moveEntry.currentParentHint;
    case "selfOrDescendant":
      return MESSAGES.dialogs.moveEntry.selfOrDescendantHint;
    case "notLoaded":
      return MESSAGES.tree.loadFailedHint;
  }
}

function targetKey(target: MoveTarget): string {
  return target.parentFolderId ?? "project-root";
}

// Picks where an entry goes. Every possible target stays listed; the ones that cannot be
// chosen are disabled and say why (the current parent is disabled because moving there
// would change nothing).
export function MoveDialog({
  entryId,
  name,
  busy,
  onCancel,
  onChoose,
}: MoveDialogProps) {
  const { applicationStore } = useWorkspaceServices();
  const application = useStoreSelector(applicationStore, identity);
  const targets = selectMoveTargets(application, entryId);
  const titleId = useId();
  const descriptionId = useId();
  const firstEnabledRef = useRef<HTMLButtonElement | null>(null);
  const firstEnabledTarget = targets.find(
    (target) => target.disabledReason === null,
  );
  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={onCancel}
      initialFocusRef={firstEnabledRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {`「${name}」${MESSAGES.tree.moveTo}`}
      </h2>
      <p id={descriptionId} className="modal__body">
        {MESSAGES.dialogs.moveEntry.description}
      </p>
      <ul
        className="move-dialog__list"
        aria-label={MESSAGES.dialogs.moveEntry.listLabel}
      >
        {targets.map((target) => {
          const reason = target.disabledReason;
          return (
            <li
              key={targetKey(target)}
              className="move-dialog__item"
              style={{ "--move-dialog-depth": target.depth } as CSSProperties}
            >
              <button
                ref={
                  firstEnabledTarget !== undefined &&
                  targetKey(firstEnabledTarget) === targetKey(target)
                    ? firstEnabledRef
                    : undefined
                }
                type="button"
                className="button move-dialog__target"
                disabled={busy || reason !== null}
                title={reason === null ? undefined : disabledHint(reason)}
                aria-description={
                  reason === null ? undefined : disabledHint(reason)
                }
                onClick={() => onChoose(target.parentFolderId)}
              >
                {target.name}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="modal__actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onCancel}
        >
          {MESSAGES.dialogs.cancel}
        </button>
      </div>
    </Modal>
  );
}
