import { describe, expect, it } from "vitest";
import type { AiHistoryEntry } from "../../application/ports/ai-access-gateway";
import { textOf } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import {
  BLOCK_ONE,
  openedCanvasHarness,
} from "../canvas/test-support/canvas-harness";

import { revertAiChange } from "./ai-history-revert";

function entry(after: string): AiHistoryEntry {
  return {
    at: 0,
    tool: "updateBlock",
    documentId: DOCUMENT_A,
    sheetId: SHEET_A1,
    blockId: BLOCK_ONE,
    before: "before the AI",
    after,
    afterHash: null,
  };
}

describe("revertAiChange", () => {
  it("puts the text back while the block still holds what the AI wrote", async () => {
    const harness = await openedCanvasHarness();
    const result = await revertAiChange(
      {
        applicationStore: harness.store,
        actions: harness.actions,
        canvasActions: harness.canvasActions,
      },
      entry(textOf(BLOCK_ONE)),
    );
    expect(result.ok).toBe(true);
    expect(
      harness.store
        .getState()
        .documents.get(DOCUMENT_A)
        ?.contents.get(BLOCK_ONE),
    ).toBe("before the AI");
  });

  it("refuses when the text was changed since", async () => {
    const harness = await openedCanvasHarness();
    const result = await revertAiChange(
      {
        applicationStore: harness.store,
        actions: harness.actions,
        canvasActions: harness.canvasActions,
      },
      entry("something the AI wrote earlier"),
    );
    expect(!result.ok && result.error.kind).toBe("staleContent");
    expect(
      harness.store
        .getState()
        .documents.get(DOCUMENT_A)
        ?.contents.get(BLOCK_ONE),
    ).toBe(textOf(BLOCK_ONE));
  });
});
