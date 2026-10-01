import type { BlockType } from "../../domain/block/block-type";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
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

// The small header above the canvas. Failures of an action are recorded by the action
// (shown in the notifications), so nothing is handled here.
export function CanvasToolbar({
  documentId,
  sheetId,
  measureCanvas,
}: CanvasToolbarProps) {
  const { canvasActions } = useWorkspaceServices();
  function createBlock(blockType: BlockType): void {
    void canvasActions.createBlock({
      documentId,
      sheetId,
      blockType,
      viewportSize: measureCanvas(),
    });
  }
  return (
    <div
      role="toolbar"
      aria-label={CANVAS_MESSAGES.toolbar.label}
      className="canvas-toolbar"
    >
      <BlockCreateMenu onCreate={createBlock} />
    </div>
  );
}
