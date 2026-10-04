// Where a paste puts the top-left corner of the pasted group (docs/architecture.md §9.5).

import type { ClipboardContent } from "../../../application/clipboard/clipboard";
import { commitPosition } from "../../../application/commit-geometry";
import { PASTE_OFFSET } from "../../../config/canvas-config";
import type { DomainResult } from "../../../domain/shared/domain-result";
import type { Position } from "../../../domain/shared/geometry";
import type { Rect } from "./viewport-math";

export interface PasteTargetInput {
  readonly content: ClipboardContent;
  // The paste goes to the sheet the content was copied from.
  readonly sameSheet: boolean;
  // The part of the target sheet's world that is currently on screen.
  readonly visible: Rect;
}

function groupExtent(content: ClipboardContent): {
  readonly width: number;
  readonly height: number;
} {
  return {
    width: Math.max(
      0,
      ...content.blocks.map((block) => block.offset.x + block.size.width),
    ),
    height: Math.max(
      0,
      ...content.blocks.map((block) => block.offset.y + block.size.height),
    ),
  };
}

// Same sheet: PASTE_OFFSET further from the originals for every earlier paste, so the
// first paste lands one step away and repeated pastes fan out. Elsewhere: the group's
// bounding box is centred in the visible area. Rounded to integers like every committed
// position; out-of-range values are rejected by the domain.
export function pasteTarget(input: PasteTargetInput): DomainResult<Position> {
  const { content, sameSheet, visible } = input;
  if (sameSheet) {
    const steps = content.pasteCount + 1;
    return commitPosition({
      x: content.source.origin.x + PASTE_OFFSET.x * steps,
      y: content.source.origin.y + PASTE_OFFSET.y * steps,
    });
  }
  const extent = groupExtent(content);
  return commitPosition({
    x: visible.x + (visible.width - extent.width) / 2,
    y: visible.y + (visible.height - extent.height) / 2,
  });
}
