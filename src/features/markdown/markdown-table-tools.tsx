import type { MouseEvent } from "react";
import {
  applyTableOperation,
  findTableAt,
  type TableCell,
  type TableOperation,
  writeTable,
} from "../../domain/markdown-table/markdown-table";
import { useContextMenu } from "../../shared/menu/context-menu";
import type { PopupMenuEntry } from "../../shared/menu/menu-list";
import type { SourceToolsContext } from "../text-block/text-block-editor";
import type { MarkdownMessages } from "./markdown-messages";

type TableMessages = MarkdownMessages["table"];

interface PlannedOperation {
  readonly operation: TableOperation;
  // Where the caret goes afterwards (the cell that moved, the new row ...).
  readonly caret: TableCell;
}

// The "Table" button of the Markdown source bar: shown only while the caret is in a table
// that can be edited safely. Each item rewrites the table's lines only; an operation whose
// result would not read back as the intended table changes nothing.
export function MarkdownTableTools({
  context,
  messages,
}: {
  readonly context: SourceToolsContext;
  readonly messages: TableMessages;
}) {
  const menu = useContextMenu();
  const location = findTableAt(context.text, context.caret);
  if (location === null) return null;
  const { cell, table } = location;
  const lastRow = table.rows.length - 1;
  const lastColumn = table.header.length - 1;
  const inBody = cell.row !== null;
  const row = cell.row ?? 0;
  const column = cell.column;

  function run(planned: PlannedOperation): void {
    if (location === null) return;
    const edited = applyTableOperation(location.table, planned.operation);
    if (edited === null) return;
    const written = writeTable(context.text, location, edited, planned.caret);
    if (written !== null) context.replaceText(written.text, written.caret);
  }

  const item = (
    id: string,
    label: string,
    planned: PlannedOperation,
    disabled = false,
    hint?: string,
  ): PopupMenuEntry => ({
    id,
    label,
    disabled,
    ...(hint === undefined ? {} : { hint }),
    onSelect: () => run(planned),
  });
  const headerHint = inBody ? undefined : messages.headerRowHint;
  const entries: PopupMenuEntry[] = [
    item(
      "insertRowAbove",
      messages.insertRowAbove,
      { operation: { kind: "insertRow", at: row }, caret: { row, column } },
      !inBody,
      headerHint,
    ),
    item("insertRowBelow", messages.insertRowBelow, {
      operation: { kind: "insertRow", at: inBody ? row + 1 : 0 },
      caret: { row: inBody ? row + 1 : 0, column },
    }),
    item(
      "deleteRow",
      messages.deleteRow,
      {
        operation: { kind: "deleteRow", row },
        caret: { row: Math.max(row - 1, 0), column },
      },
      !inBody,
      headerHint,
    ),
    item(
      "moveRowUp",
      messages.moveRowUp,
      {
        operation: { kind: "moveRow", from: row, to: row - 1 },
        caret: { row: row - 1, column },
      },
      !inBody || row === 0,
      headerHint,
    ),
    item(
      "moveRowDown",
      messages.moveRowDown,
      {
        operation: { kind: "moveRow", from: row, to: row + 1 },
        caret: { row: row + 1, column },
      },
      !inBody || row >= lastRow,
      headerHint,
    ),
    { id: "separator-columns", separator: true },
    item("insertColumnLeft", messages.insertColumnLeft, {
      operation: { kind: "insertColumn", at: column },
      caret: { row: cell.row, column },
    }),
    item("insertColumnRight", messages.insertColumnRight, {
      operation: { kind: "insertColumn", at: column + 1 },
      caret: { row: cell.row, column: column + 1 },
    }),
    item(
      "deleteColumn",
      messages.deleteColumn,
      {
        operation: { kind: "deleteColumn", column },
        caret: { row: cell.row, column: Math.max(column - 1, 0) },
      },
      lastColumn === 0,
    ),
    item(
      "moveColumnLeft",
      messages.moveColumnLeft,
      {
        operation: { kind: "moveColumn", from: column, to: column - 1 },
        caret: { row: cell.row, column: column - 1 },
      },
      column === 0,
    ),
    item(
      "moveColumnRight",
      messages.moveColumnRight,
      {
        operation: { kind: "moveColumn", from: column, to: column + 1 },
        caret: { row: cell.row, column: column + 1 },
      },
      column >= lastColumn,
    ),
    { id: "separator-alignment", separator: true },
    ...(
      [
        ["alignLeft", messages.alignLeft, "left"],
        ["alignCenter", messages.alignCenter, "center"],
        ["alignRight", messages.alignRight, "right"],
        ["alignNone", messages.alignNone, "none"],
      ] as const
    ).map(([id, label, alignment]) =>
      item(
        id,
        label,
        {
          operation: { kind: "setAlignment", column, alignment },
          caret: cell,
        },
        table.alignments[column] === alignment,
      ),
    ),
    { id: "separator-format", separator: true },
    item("format", messages.format, {
      operation: { kind: "format" },
      caret: cell,
    }),
  ];

  return (
    <>
      <button
        type="button"
        className="button"
        aria-haspopup="menu"
        onClick={(event: MouseEvent<HTMLButtonElement>) =>
          menu.openFromEvent(
            event,
            messages.menuLabel,
            entries,
            event.currentTarget,
          )
        }
      >
        {messages.button}
      </button>
      {menu.element}
    </>
  );
}
