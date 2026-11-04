// The right-click menus of the canvas: one for blocks (the selection), one for the empty
// canvas. Built as plain data so what is offered can be tested without a canvas.

import type { ReorderDirection } from "../../application/commands/block-commands";
import type { BlockType } from "../../domain/block/block-type";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import {
  MERMAID_TEMPLATE_IDS,
  type MermaidTemplateId,
} from "../mermaid/mermaid-templates";
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
  // Absent when the block is not a figure (no caption to edit).
  readonly editCaption?: () => void;
  // Absent when the figure has no caption to remove.
  readonly removeCaption?: () => void;
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
    ...(commands.editCaption === undefined
      ? []
      : [
          {
            id: "editCaption",
            label: labels.editCaption,
            onSelect: commands.editCaption,
          },
        ]),
    ...(commands.removeCaption === undefined
      ? []
      : [
          {
            id: "removeCaption",
            label: labels.removeCaption,
            onSelect: commands.removeCaption,
          },
        ]),
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
  readonly addBlock: (
    blockType: BlockType,
    mermaidTemplate?: MermaidTemplateId,
  ) => void;
  // Opens the image file dialog; the first image goes where the menu was opened.
  readonly addImage: () => void;
  readonly paste: () => void;
}

// The other kinds of diagram, one item per template, for a "templates" submenu.
export function templateEntries(
  templateNames: Readonly<Record<MermaidTemplateId, string>>,
  addTemplate: (template: MermaidTemplateId) => void,
): PopupMenuEntry[] {
  return MERMAID_TEMPLATE_IDS.map((template) => ({
    id: `add-mermaid-${template}`,
    label: templateNames[template],
    onSelect: () => addTemplate(template),
  }));
}

export function backgroundMenuEntries(
  messages: CanvasMessages,
  templateNames: Readonly<Record<MermaidTemplateId, string>>,
  commands: BackgroundMenuCommands,
): PopupMenuEntry[] {
  return [
    ...CREATABLE_BLOCK_TYPES.map((creatable) => ({
      id: `add-${creatable.blockType}`,
      label: messages.contextMenu.addBlock(creatable.label),
      onSelect: () => commands.addBlock(creatable.blockType),
    })),
    {
      id: "addFromTemplate",
      label: messages.contextMenu.templates,
      entries: templateEntries(templateNames, (template) =>
        commands.addBlock("mermaid", template),
      ),
    },
    {
      id: "addImage",
      label: messages.contextMenu.addImage,
      onSelect: commands.addImage,
    },
    { id: "addSeparator", separator: true },
    {
      id: "paste",
      label: messages.contextMenu.paste,
      onSelect: commands.paste,
    },
  ];
}
