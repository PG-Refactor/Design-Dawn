import { describe, expect, it } from "vitest";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { openedActionsHarness } from "../workspace/test-support/actions-harness";

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
