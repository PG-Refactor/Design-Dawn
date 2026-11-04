import { describe, expect, it } from "vitest";
import { previewDiagramOperation } from "./preview-diagram-operation";

const SOURCE = "flowchart LR\n  A[Start] --> B[End]\n";

describe("previewDiagramOperation", () => {
  it("gives the text an add would produce, without changing anything else", () => {
    const preview = previewDiagramOperation(SOURCE, {
      diagram: "flowchart",
      operation: { kind: "addNode", label: "Pay", shape: "square", id: "P" },
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.startsWith(SOURCE.trimEnd())).toBe(true);
    expect(preview.value).toContain(`P["Pay"]`);
  });

  it("refuses what the operation itself would refuse", () => {
    const preview = previewDiagramOperation(SOURCE, {
      diagram: "flowchart",
      operation: { kind: "addNode", label: "Again", shape: "square", id: "A" },
    });
    expect(preview.ok).toBe(false);
  });
});
