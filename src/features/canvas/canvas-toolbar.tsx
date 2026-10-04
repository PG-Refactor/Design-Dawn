import type { ReorderDirection } from "../../application/commands/block-commands";
import type { BlockType } from "../../domain/block/block-type";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { PopupMenu, type PopupMenuItem } from "../../shared/menu/popup-menu";
import { getSelection } from "../workspace/ui-state/ui-state";
import { useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { BlockCreateMenu } from "./block-create-menu";
import { CANVAS_MESSAGES } from "./canvas-messages";
import type { Extent } from "./geometry/viewport-math";
import "./canvas-toolbar.css";

export interface CanvasToolbarProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  // Size of the canvas on screen, read when a block is added so it lands in view.
  readonly measureCanvas: () => Extent;
}

const REORDER_ITEMS: readonly {
  readonly direction: ReorderDirection;
  readonly label: string;
}[] = [
  { direction: "forward", label: CANVAS_MESSAGES.reorder.forward },
  { direction: "backward", label: CANVAS_MESSAGES.reorder.backward },
  { direction: "toFront", label: CANVAS_MESSAGES.reorder.toFront },
  { direction: "toBack", label: CANVAS_MESSAGES.reorder.toBack },
];

// The small header above the canvas. Failures of an action are recorded by the action
// (shown in the notifications), so nothing is handled here.
export function CanvasToolbar({
  documentId,
  sheetId,
  measureCanvas,
}: CanvasToolbarProps) {
  const { canvasActions } = useWorkspaceServices();
  const hasSelection = useUiState((ui) => getSelection(ui, sheetId).size) > 0;
  function createBlock(blockType: BlockType): void {
    void canvasActions.createBlock({
      documentId,
      sheetId,
      blockType,
      viewportSize: measureCanvas(),
    });
  }
  const reorderItems: readonly PopupMenuItem[] = REORDER_ITEMS.map((item) => ({
    id: item.direction,
    label: item.label,
    // Stays visible so the menu can be discovered; does nothing without a selection.
    disabled: !hasSelection,
    onSelect: () => {
      void canvasActions.reorderSelection({
        documentId,
        sheetId,
        direction: item.direction,
      });
    },
  }));
  return (
    <div
      role="toolbar"
      aria-label={CANVAS_MESSAGES.toolbar.label}
      className="canvas-toolbar"
    >
      <BlockCreateMenu onCreate={createBlock} />
      <PopupMenu
        className="reorder-menu"
        triggerLabel={CANVAS_MESSAGES.reorder.menuButton}
        triggerContent={CANVAS_MESSAGES.reorder.menuButton}
        menuLabel={CANVAS_MESSAGES.reorder.menuLabel}
        items={reorderItems}
      />
    </div>
  );
}
