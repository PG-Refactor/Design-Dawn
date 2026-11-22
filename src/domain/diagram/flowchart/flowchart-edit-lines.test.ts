import { describe, expect, it } from "vitest";
import { applyTextEdits, type TextEdit } from "../text-edit";
import {
  appendLineEdit,
  deleteLinesEdits,
  dominantLineEnding,
  indentOfLine,
  insertLineAfterEdit,
  insertLineBeforeEdit,
  occupiesWholeLine,
  topLevelIndent,
} from "./flowchart-edit-lines";
import { readFlowchart } from "./flowchart-reader";

function edited(source: string, edits: readonly TextEdit[]): string {
  const applied = applyTextEdits(source, edits);
  if (!applied.ok) throw new Error(applied.error.detail);
  return applied.value.text;
}

describe("indentation", () => {
  it("is the default with no statement after the header, or no header at all", () => {
    expect(topLevelIndent(readFlowchart("flowchart TD\n"))).toBe("    ");
    expect(topLevelIndent(readFlowchart(""))).toBe("    ");
    expect(topLevelIndent(readFlowchart("flowchart TD\n\tA\n"))).toBe("\t");
  });

  it("is empty for a line that is not there", () => {
    expect(indentOfLine(readFlowchart("flowchart TD\n"), 9)).toBe("");
  });

  it("follows the line ending most lines use", () => {
    expect(dominantLineEnding(readFlowchart("flowchart TD\r\nA\r\nB\n"))).toBe(
      "\r\n",
    );
  });
});

describe("adding lines", () => {
  it("appends to an empty text and after a last line without a break", () => {
    expect(edited("", [appendLineEdit(readFlowchart(""), "A")])).toBe("A\n");
    const source = "flowchart TD\n    A";
    expect(
      edited(source, [appendLineEdit(readFlowchart(source), "    B")]),
    ).toBe("flowchart TD\n    A\n    B");
  });

  it("inserts before or after a line, and at the end for a line that is not there", () => {
    const source = "flowchart TD\n    A";
    const reading = readFlowchart(source);
    expect(edited(source, [insertLineBeforeEdit(reading, 1, "    Z")])).toBe(
      "flowchart TD\n    Z\n    A",
    );
    expect(edited(source, [insertLineBeforeEdit(reading, 9, "%% x")])).toBe(
      "%% x\nflowchart TD\n    A",
    );
    expect(edited(source, [insertLineAfterEdit(reading, 1, "    B")])).toBe(
      "flowchart TD\n    A\n    B",
    );
    expect(edited(source, [insertLineAfterEdit(reading, 9, "    B")])).toBe(
      "flowchart TD\n    A\n    B",
    );
  });
});

describe("whole lines", () => {
  it("knows a statement alone on its line, with or without a ;", () => {
    const reading = readFlowchart("flowchart TD\n    A;\n    B; C\n");
    const [a, b] = reading.statements;
    if (a === undefined || b === undefined) throw new Error("no statements");
    expect(occupiesWholeLine(reading, a)).toBe(true);
    expect(occupiesWholeLine(reading, b)).toBe(false);
    const onHeader = readFlowchart("flowchart TD; A\n");
    const [first] = onHeader.statements;
    if (first === undefined) throw new Error("no statement");
    expect(occupiesWholeLine(onHeader, first)).toBe(false);
  });

  it("deletes the last line with the break before it, and skips lines that are not there", () => {
    const source = "flowchart TD\n    A\n    B";
    const reading = readFlowchart(source);
    expect(edited(source, deleteLinesEdits(reading, new Set([2, 9])))).toBe(
      "flowchart TD\n    A",
    );
    expect(
      edited("A", deleteLinesEdits(readFlowchart("A"), new Set([0]))),
    ).toBe("");
  });
});
