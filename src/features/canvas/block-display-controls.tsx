import type { Block } from "../../domain/block/block";
import {
  blockDisplayOf,
  steppedScalePercent,
} from "../../domain/block/content-scale";
import {
  CONTENT_SCALE_DEFAULT_PERCENT,
  CONTENT_SCALE_MAX_PERCENT,
  CONTENT_SCALE_MIN_PERCENT,
} from "../../domain/domain-constants";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { BLOCK_CONTROLS_ATTRIBUTE } from "./block-dom";
import { blockAccessibleName } from "./canvas-messages";

interface BlockDisplayControlsProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly block: Block;
  // What a fitted block is shown at (null until it has been worked out).
  readonly fittedPercent: number | null;
}

// − / the size / + / Auto over a Markdown or Mermaid block, shown while the pointer is on
// the block (or it is selected). Each press is one change of the Document (Undo takes it
// back). The size reads the fitted size while fitting; pressing it goes back to 100%.
export function BlockDisplayControls({
  documentId,
  sheetId,
  block,
  fittedPercent,
}: BlockDisplayControlsProps) {
  const messages = useMessages().canvas.display;
  const { canvasActions } = useWorkspaceServices();
  const display = blockDisplayOf(block);
  const shown = display.autoFit
    ? (fittedPercent ?? display.scalePercent)
    : display.scalePercent;

  function set(next: typeof display): void {
    void canvasActions.setBlockDisplay({
      documentId,
      sheetId,
      blockId: block.blockId,
      display: next,
    });
  }
  // Leaving "fit" with −/+ starts from what is on screen, so the step is from there.
  function step(direction: -1 | 1): void {
    set({
      scalePercent: steppedScalePercent(shown, direction),
      autoFit: false,
    });
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a small toolbar-like group.
    <div
      role="group"
      aria-label={messages.group(blockAccessibleName(block))}
      className="block-display"
      {...{ [BLOCK_CONTROLS_ATTRIBUTE]: "" }}
    >
      <button
        type="button"
        className="block-display__button"
        aria-label={messages.smaller}
        title={messages.smaller}
        disabled={!display.autoFit && shown <= CONTENT_SCALE_MIN_PERCENT}
        onClick={() => step(-1)}
      >
        {messages.smallerText}
      </button>
      <button
        type="button"
        className="block-display__button block-display__percent"
        aria-label={messages.reset}
        title={messages.reset}
        disabled={!display.autoFit && shown === CONTENT_SCALE_DEFAULT_PERCENT}
        onClick={() =>
          set({
            scalePercent: blockDisplayOf({ blockType: block.blockType })
              .scalePercent,
            autoFit: false,
          })
        }
      >
        {messages.percent(shown)}
      </button>
      <button
        type="button"
        className="block-display__button"
        aria-label={messages.larger}
        title={messages.larger}
        disabled={!display.autoFit && shown >= CONTENT_SCALE_MAX_PERCENT}
        onClick={() => step(1)}
      >
        {messages.largerText}
      </button>
      <button
        type="button"
        className="block-display__button block-display__auto"
        aria-pressed={display.autoFit}
        aria-label={messages.autoFit}
        title={messages.autoFit}
        onClick={() =>
          set({ scalePercent: display.scalePercent, autoFit: !display.autoFit })
        }
      >
        {messages.autoFitText}
      </button>
    </div>
  );
}
