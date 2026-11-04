import type { BlockType } from "../../domain/block/block-type";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { PopupMenu, type PopupMenuEntry } from "../../shared/menu/popup-menu";
import type { MermaidTemplateId } from "../mermaid/mermaid-templates";
import { getSelection } from "../workspace/ui-state/ui-state";
import { useMessages } from "../workspace/use-messages";
import { useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { BlockCreateMenu } from "./block-create-menu";
import { REORDER_ITEMS } from "./canvas-context-menu";
import type { CanvasMessages } from "./canvas-messages";
import type { AlignMode } from "./geometry/align";
import type { Extent } from "./geometry/viewport-math";
import "./canvas-toolbar.css";

export interface CanvasToolbarProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  // Size of the canvas on screen, read when a block is added so it lands in view.
  readonly measureCanvas: () => Extent;
}

// Top / vertical entries come after the separator.
const ALIGN_ITEMS: readonly (
  | {
      readonly mode: AlignMode;
      readonly labelKey: keyof CanvasMessages["align"];
    }
  | { readonly separator: true }
)[] = [
  { mode: "alignLeft", labelKey: "left" },
  { mode: "alignHorizontalCenter", labelKey: "horizontalCenter" },
  { mode: "alignRight", labelKey: "right" },
  { separator: true },
  { mode: "alignTop", labelKey: "top" },
  { mode: "alignVerticalCenter", labelKey: "verticalCenter" },
  { mode: "alignBottom", labelKey: "bottom" },
];

// Aligning needs a reference: at least two blocks.
const MIN_ALIGN_SELECTION = 2;

// The small header above the canvas. Failures of an action are recorded by the action
// (shown in the notifications), so nothing is handled here.
export function CanvasToolbar({
  documentId,
  sheetId,
  measureCanvas,
}: CanvasToolbarProps) {
  const messages = useMessages().canvas;
  const { canvasActions } = useWorkspaceServices();
  const selectionSize = useUiState((ui) => getSelection(ui, sheetId).size);
  const hasSelection = selectionSize > 0;
  function createBlock(
    blockType: BlockType,
    mermaidTemplate?: MermaidTemplateId,
  ): void {
    void canvasActions.createBlock({
      documentId,
      sheetId,
      blockType,
      mermaidTemplate,
      viewportSize: measureCanvas(),
    });
  }
  const alignItems: readonly PopupMenuEntry[] = ALIGN_ITEMS.map(
    (item, index) =>
      "separator" in item
        ? { id: `align-separator-${index}`, separator: true }
        : {
            id: item.mode,
            label: messages.align[item.labelKey],
            disabled: selectionSize < MIN_ALIGN_SELECTION,
            onSelect: () => {
              void canvasActions.alignSelection({
                documentId,
                sheetId,
                mode: item.mode,
              });
            },
          },
  );
  const reorderItems: readonly PopupMenuEntry[] = REORDER_ITEMS.map((item) => ({
    id: item.direction,
    label: messages.reorder[item.labelKey],
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
      aria-label={messages.toolbar.label}
      className="canvas-toolbar"
    >
      <BlockCreateMenu
        onCreate={createBlock}
        onAddImage={() =>
          void canvasActions.addImagesFromFiles({
            viewportSize: measureCanvas(),
          })
        }
      />
      <PopupMenu
        className="align-menu"
        triggerLabel={messages.align.menuButton}
        triggerContent={messages.align.menuButton}
        menuLabel={messages.align.menuLabel}
        items={alignItems}
      />
      <PopupMenu
        className="reorder-menu"
        triggerLabel={messages.reorder.menuButton}
        triggerContent={messages.reorder.menuButton}
        menuLabel={messages.reorder.menuLabel}
        items={reorderItems}
      />
    </div>
  );
}
