import { describe, expect, it } from "vitest";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import { err, ok } from "../../domain/shared/domain-result";
import { diagramCandidate } from "./diagram-candidate";

const SOURCE = 'pie\r\n    "A" : 1\r\n';
const OPERATION: DiagramOperation = {
  diagram: "pie",
  operation: { kind: "setTitle", title: "T" },
};

describe("diagramCandidate", () => {
  it("plans, applies and proves the text in its stored form", () => {
    const candidate = diagramCandidate(SOURCE, OPERATION);
    expect(candidate.ok && candidate.value.changed).toBe(true);
    expect(candidate.ok && candidate.value.text).not.toContain("\r");
  });

  it("passes a refused plan on", () => {
    const refused = err("invalidDiagramOperation", "no") as never;
    expect(diagramCandidate(SOURCE, OPERATION, () => refused).ok).toBe(false);
  });

  it("refuses edits that cannot be applied, and a text the plan does not prove", () => {
    const overlapping = diagramCandidate(SOURCE, OPERATION, () =>
      ok({
        edits: [
          { start: 0, end: 3, text: "" },
          { start: 1, end: 4, text: "" },
        ],
        verify: () => ok(undefined),
      }),
    );
    expect(overlapping.ok).toBe(false);
    const unproven = diagramCandidate(SOURCE, OPERATION, () =>
      ok({
        edits: [{ start: 0, end: 0, text: "%% x\n" }],
        verify: () => err("diagramMeaningMismatch", "no"),
      }),
    );
    expect(unproven.ok).toBe(false);
  });

  it("does not prove an operation that changes nothing", () => {
    const unchanged = diagramCandidate(SOURCE, OPERATION, () =>
      ok({ edits: [], verify: () => err("diagramMeaningMismatch", "no") }),
    );
    expect(unchanged.ok && unchanged.value.changed).toBe(false);
  });
});
