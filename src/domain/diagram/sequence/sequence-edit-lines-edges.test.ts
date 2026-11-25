import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import { indentUnitOf, removeStatementEdits } from "./sequence-edit-lines";
import { readSequence } from "./sequence-reader";

function removed(source: string, statementIndex: number): string {
  const reading = readSequence(source);
  const statement = reading.statements[statementIndex];
  if (statement === undefined) throw new Error("no such statement");
  const applied = applyTextEdits(
    source,
    removeStatementEdits(reading, statement),
  );
  if (!applied.ok) throw new Error(applied.error.detail);
  return applied.value.text;
}

describe("removing a statement", () => {
  it("takes the separator in front of the last statement of a shared line", () => {
    expect(removed("sequenceDiagram\nA->>B: x; B->>A: y\n", 1)).toBe(
      "sequenceDiagram\nA->>B: x\n",
    );
  });

  it("leaves a comment behind the statement, with and without a separator", () => {
    expect(removed("sequenceDiagram\nA->>B: x # c\n", 0)).toBe(
      "sequenceDiagram\n # c\n",
    );
    expect(removed("sequenceDiagram\nA->>B: x; # c\n", 0)).toBe(
      "sequenceDiagram\n # c\n",
    );
  });
});

describe("the indentation unit", () => {
  it("is found after a nested block has closed", () => {
    const source =
      "sequenceDiagram\n  loop a\n  end\n  loop b\n      A->>B: x\n  end\n";
    expect(indentUnitOf(readSequence(source))).toBe("    ");
  });

  it("is the default for a file that indents nothing", () => {
    expect(indentUnitOf(readSequence("sequenceDiagram\nA->>B: x\n"))).not.toBe(
      "",
    );
  });
});
