import { describe, expect, it } from "vitest";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { openedActionsHarness } from "../workspace/test-support/actions-harness";
import { exportStems } from "./export-actions";

describe("exportStems", () => {
  it("numbers a name used before, ignoring case", () => {
    expect(exportStems(["API", "Order", "api", "API"])).toEqual([
      "API",
      "Order",
      "api (2)",
      "API (3)",
    ]);
  });
});

describe("exportDocumentMarkdown", () => {
  it("saves first, then exports the Document from disk", async () => {
    const harness = await openedActionsHarness();
    harness.gateway.clearCalls();
    const result =
      await harness.services.exportActions.exportDocumentMarkdown(DOCUMENT_A);
    expect(result).toEqual({
      ok: true,
      value: { status: "saved", fileName: `${DOCUMENT_A}.md` },
    });
    expect(harness.gateway.methods("exportDocumentMarkdown")).toHaveLength(1);
  });
});
