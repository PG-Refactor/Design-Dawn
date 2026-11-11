import { describe, expect, it } from "vitest";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { openedCanvasHarness } from "../canvas/test-support/canvas-harness";
import { DESIGN_TEMPLATE_IDS, DESIGN_TEMPLATES } from "./design-templates";
import { createSheetFromTemplate } from "./template-actions";

describe("createSheetFromTemplate", () => {
  it.each(DESIGN_TEMPLATE_IDS)(
    "creates a sheet named after %s with its blocks as one undoable step",
    async (templateId) => {
      const harness = await openedCanvasHarness();
      const template = DESIGN_TEMPLATES[templateId];
      const result = await createSheetFromTemplate(
        {
          actions: harness.actions,
          canvasActions: harness.canvasActions,
          uiStateStore: harness.uiStateStore,
        },
        DOCUMENT_A,
        templateId,
        "ja",
      );
      expect(result.ok).toBe(true);
      const sheetId = harness.uiStateStore
        .getState()
        .activeSheetIdByDocument.get(DOCUMENT_A);
      const document = harness.store.getState().documents.get(DOCUMENT_A);
      const sheet =
        sheetId === undefined ? undefined : document?.sheets.get(sheetId);
      expect(sheet?.name).toBe(template.name.ja);
      expect(sheet?.blocks.map((block) => block.blockType)).toEqual(
        template.blocks.map((block) => block.blockType),
      );
      expect(harness.session.getState().history.canUndo).toBe(true);
    },
  );
});
