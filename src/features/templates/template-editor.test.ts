import { describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { createActionsHarness } from "../workspace/test-support/actions-harness";

// A window whose Project was made for editing a sheet template: it starts empty.
async function editingWindow() {
  const harness = createActionsHarness();
  harness.templateGateway.editing = {
    scope: "global",
    kind: "sheet",
    templateId: "template-9",
    name: "Review",
    content: {
      name: "Review",
      sheets: [
        {
          sheetName: "Review",
          blocks: [
            {
              blockType: "markdown",
              x: 0,
              y: 0,
              width: 320,
              height: 200,
              text: "# Review\n",
            },
            {
              blockType: "mermaid",
              x: 400,
              y: 0,
              width: 320,
              height: 200,
              text: "flowchart LR\n  A --> B\n",
              caption: "Flow",
            },
          ],
        },
      ],
      assets: [],
    },
  };
  await harness.actions.chooseProjectLocation();
  const created = await harness.actions.createProjectViaDialog({
    name: "Review",
    locationSelectionId: "selection-1",
    folderName: "review",
    makeDefaultLocation: false,
  });
  if (!created.ok) throw new Error("project");
  for (let step = 0; step < 5; step += 1) await settle();
  return harness;
}

describe("a window that edits a Custom Template", () => {
  it("fills its empty Project from the template, with nothing unsaved", async () => {
    const harness = await editingWindow();
    const editor = harness.services.templateEditor;
    expect(editor.store.getState().editing).toMatchObject({
      kind: "sheet",
      name: "Review",
    });
    const [document] = harness.store.getState().documents.values();
    const [sheet] = document?.sheets.values() ?? [];
    expect(sheet?.name).toBe("Review");
    expect(sheet?.blocks.map((block) => block.blockType)).toEqual([
      "markdown",
      "mermaid",
    ]);
    expect(sheet?.blocks[1]?.caption).toBe("Flow");
    expect(await editor.hasUnsavedChanges()).toBe(false);
  });

  it("tells an edit apart and writes it back to the template on save", async () => {
    const harness = await editingWindow();
    const editor = harness.services.templateEditor;
    const [documentId] = harness.store.getState().documents.keys();
    const document =
      documentId === undefined
        ? undefined
        : harness.store.getState().documents.get(documentId);
    const [sheet] = document?.sheets.values() ?? [];
    const block = sheet?.blocks[0];
    if (
      documentId === undefined ||
      sheet === undefined ||
      block === undefined
    ) {
      throw new Error("filled");
    }
    await harness.canvasActions.commitContentEdit({
      documentId,
      sheetId: sheet.sheetId,
      blockId: block.blockId,
      text: "# Changed\n",
    });
    expect(await editor.hasUnsavedChanges()).toBe(true);
    expect((await editor.save()).ok).toBe(true);
    const [saved] = harness.templateGateway.savedEdits;
    expect(saved?.content.sheets[0]?.blocks[0]?.text).toBe("# Changed\n");
    expect(await editor.hasUnsavedChanges()).toBe(false);
  });

  it("is not active in an ordinary window", async () => {
    const harness = createActionsHarness();
    await harness.actions.openProjectViaDialog();
    await settle();
    expect(harness.services.templateEditor.isEditing()).toBe(false);
    expect(await harness.services.templateEditor.hasUnsavedChanges()).toBe(
      false,
    );
  });
});
