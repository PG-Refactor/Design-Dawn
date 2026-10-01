// The frame a block is drawn at: its Domain value, or the in-progress drag / resize
// preview from UI state. The Domain value itself is never touched before the commit.

import type { Block } from "../../../domain/block/block";
import type { SheetId } from "../../../domain/shared/entity-id";
import type { Interaction } from "../../workspace/ui-state/ui-state";
import { dragPreviewPosition } from "./interaction-math";
import type { Rect } from "./viewport-math";

export function displayedFrame(
  block: Block,
  interaction: Interaction,
  sheetId: SheetId,
): Rect {
  const base: Rect = {
    x: block.position.x,
    y: block.position.y,
    width: block.size.width,
    height: block.size.height,
  };
  if (interaction.kind === "idle" || interaction.sheetId !== sheetId) {
    return base;
  }
  if (interaction.kind === "dragging") {
    return interaction.blockIds.includes(block.blockId)
      ? { ...base, ...dragPreviewPosition(base, interaction.delta) }
      : base;
  }
  return interaction.blockId === block.blockId ? interaction.frame : base;
}

export function isInteracting(
  block: Block,
  interaction: Interaction,
  sheetId: SheetId,
): boolean {
  if (interaction.kind === "idle" || interaction.sheetId !== sheetId) {
    return false;
  }
  return interaction.kind === "dragging"
    ? interaction.blockIds.includes(block.blockId)
    : interaction.blockId === block.blockId;
}
