// @vitest-environment jsdom
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { renderShell } from "../workspace/test-support/shell-harness";

afterEach(() => {
  cleanup();
});

// A window made for editing a block template, filled once its Project is there.
async function editingWindow() {
  const shell = await renderShell({
    seed: (harness) => {
      harness.templateGateway.editing = {
        scope: "global",
        kind: "markdown",
        templateId: "template-1",
        name: "Note",
        content: {
          name: "Note",
          block: {
            blockType: "markdown",
            x: 0,
            y: 0,
            width: 320,
            height: 200,
            text: "# Note\n",
          },
          sheets: [],
          assets: [],
        },
      };
    },
  });
  await act(async () => {
    await shell.actions.chooseProjectLocation();
    await shell.actions.createProjectViaDialog({
      name: "Note",
      locationSelectionId: "selection-1",
      folderName: "note",
      makeDefaultLocation: false,
    });
    for (let step = 0; step < 5; step += 1) await settle();
  });
  return shell;
}

describe("the save keys in a template editing window", () => {
  it.each([
    ["Ctrl+S", { key: "s", ctrlKey: true }],
    ["Ctrl+Shift+S", { key: "S", ctrlKey: true, shiftKey: true }],
  ])("%s writes the template back", async (_name, keys) => {
    const shell = await editingWindow();
    expect(shell.services.templateEditor.isEditing()).toBe(true);
    await act(async () => {
      fireEvent.keyDown(window, keys);
      for (let step = 0; step < 5; step += 1) await settle();
    });
    expect(shell.templateGateway.savedEdits).toHaveLength(1);
  });
});
