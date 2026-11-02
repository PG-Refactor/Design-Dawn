// The right-click menus of the canvas: one for blocks (the selection), one for the empty
// canvas. Built as plain data so what is offered can be tested without a canvas.

import type { ReorderDirection } from "../../application/commands/block-commands";
import type { BlockType } from "../../domain/block/block-type";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import type { CanvasMessages } from "./canvas-messages";
import { CREATABLE_BLOCK_TYPES } from "./creatable-block-types";

// The labels are looked up by key at render time, so they follow the display language.
export const REORDER_ITEMS: readonly {
  readonly direction: ReorderDirection;
  readonly labelKey: keyof CanvasMessages["reorder"];
}[] = [
  { direction: "forward", labelKey: "forward" },
  { direction: "backward", labelKey: "backward" },
  { direction: "toFront", labelKey: "toFront" },
  { direction: "toBack", labelKey: "toBack" },
];

export interface BlockMenuCommands {
  readonly edit: () => void;
  readonly cut: () => void;
  readonly copy: () => void;
  readonly paste: () => void;
  readonly duplicate: () => void;
  readonly reorder: (direction: ReorderDirection) => void;
  readonly delete: () => void;
}

// `canEdit`: exactly one block is selected and it has an editor (an image has none).
export function blockMenuEntries(
  messages: CanvasMessages,
  canEdit: boolean,
  commands: BlockMenuCommands,
): PopupMenuEntry[] {
  const labels = messages.contextMenu;
  return [
    {
      id: "edit",
      label: labels.edit,
      disabled: !canEdit,
      onSelect: commands.edit,
    },
    { id: "editSeparator", separator: true },
    { id: "cut", label: labels.cut, onSelect: commands.cut },
    { id: "copy", label: labels.copy, onSelect: commands.copy },
    { id: "paste", label: labels.paste, onSelect: commands.paste },
    { id: "duplicate", label: labels.duplicate, onSelect: commands.duplicate },
    { id: "clipboardSeparator", separator: true },
    ...REORDER_ITEMS.map((item) => ({
      id: item.direction,
      label: messages.reorder[item.labelKey],
      onSelect: () => commands.reorder(item.direction),
    })),
    { id: "reorderSeparator", separator: true },
    { id: "delete", label: labels.delete, onSelect: commands.delete },
  ];
}

export interface BackgroundMenuCommands {
  // The block's top-left corner goes where the menu was opened.
  readonly addBlock: (blockType: BlockType) => void;
  readonly paste: () => void;
}

export function backgroundMenuEntries(
  messages: CanvasMessages,
  commands: BackgroundMenuCommands,
): PopupMenuEntry[] {
  return [
    ...CREATABLE_BLOCK_TYPES.map((creatable) => ({
      id: `add-${creatable.blockType}`,
      label: messages.contextMenu.addBlock(creatable.label),
      onSelect: () => commands.addBlock(creatable.blockType),
    })),
    { id: "addSeparator", separator: true },
    {
      id: "paste",
      label: messages.contextMenu.paste,
      onSelect: commands.paste,
    },
  ];
}
