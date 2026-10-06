// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  blockOption,
  canvasElement,
  renderOpenedCanvas,
  sourceBox,
} from "../markdown/test-support/markdown-harness";
import { makeDocumentADirty } from "./test-support/actions-harness";
import { renderShell } from "./test-support/shell-harness";

afterEach(() => {
  cleanup();
});

const WRITE_METHODS = ["saveProject", "saveDocument", "saveSheet"] as const;
const writes = (shell: { gateway: { methods(...m: string[]): string[] } }) =>
  shell.gateway.methods(...WRITE_METHODS);

// Returns false when the event was default-prevented (fireEvent's contract).
async function press(
  target: Element | Window,
  init: KeyboardEventInit,
): Promise<boolean> {
  let notPrevented = true;
  await act(async () => {
    notPrevented = fireEvent.keyDown(target, { key: "s", ...init });
    await settle();
  });
  return notPrevented;
}

const CTRL = { ctrlKey: true };
const META = { metaKey: true };

describe("Ctrl/Cmd+S", () => {
  it("saves a dirty document immediately and prevents the default", async () => {
    const { shell } = await renderOpenedCanvas();
    const canvas = canvasElement();
    await makeDocumentADirty(shell);
    shell.gateway.clearCalls();

    expect(await press(canvas, CTRL)).toBe(false);

    expect(writes(shell).length).toBeGreaterThan(0);
    shell.gateway.clearCalls();
    // The timer was not advanced; when it fires later nothing is left to write.
    await shell.runAutoSave();
    expect(writes(shell)).toEqual([]);
  });

  it("works with Cmd (meta) too", async () => {
    const { shell } = await renderOpenedCanvas();
    const canvas = canvasElement();
    await makeDocumentADirty(shell);
    shell.gateway.clearCalls();

    expect(await press(canvas, META)).toBe(false);

    expect(writes(shell).length).toBeGreaterThan(0);
  });

  it("writes nothing when the state is clean", async () => {
    const { shell } = await renderOpenedCanvas();
    shell.gateway.clearCalls();

    expect(await press(canvasElement(), CTRL)).toBe(false);

    expect(writes(shell)).toEqual([]);
  });

  it.each([
    ["Alt+Ctrl+S", { ctrlKey: true, altKey: true }],
    ["Alt+Cmd+S", { metaKey: true, altKey: true }],
    ["Shift+Ctrl+S", { key: "S", ctrlKey: true, shiftKey: true }],
    ["Shift+Cmd+S", { key: "S", metaKey: true, shiftKey: true }],
    ["plain s", {}],
  ])("%s does nothing and is not prevented", async (_name, init) => {
    const { shell } = await renderOpenedCanvas();
    const canvas = canvasElement();
    await makeDocumentADirty(shell);
    shell.gateway.clearCalls();

    expect(await press(canvas, init)).toBe(true);

    expect(writes(shell)).toEqual([]);
  });

  it.each([
    ["the canvas", () => canvasElement()],
    ["a block body", () => blockOption(0)],
    [
      "a Project Tree item",
      () => screen.getAllByRole("treeitem")[0] as HTMLElement,
    ],
  ])("saves from %s", async (_name, target) => {
    const { shell } = await renderOpenedCanvas();
    const element = target();
    await makeDocumentADirty(shell);
    shell.gateway.clearCalls();

    await press(element, CTRL);

    expect(writes(shell).length).toBeGreaterThan(0);
  });

  it("calls saveAll once per keypress after re-renders (one listener)", async () => {
    const { shell } = await renderOpenedCanvas();
    const saveAll = vi.spyOn(shell.services.actions, "saveAll");
    await act(async () => {
      shell.uiStateStore.setState((state) => ({ ...state }));
      await settle();
    });

    await press(canvasElement(), CTRL);

    expect(saveAll).toHaveBeenCalledTimes(1);
  });

  it("does nothing after the shell is unmounted", async () => {
    const { shell } = await renderOpenedCanvas();
    await makeDocumentADirty(shell);
    shell.gateway.clearCalls();
    const saveAll = vi.spyOn(shell.services.actions, "saveAll");
    cleanup();

    expect(await press(window, CTRL)).toBe(true);

    expect(saveAll).not.toHaveBeenCalled();
    expect(writes(shell)).toEqual([]);
  });
});

describe("Ctrl/Cmd+S while editing Markdown", () => {
  const EDITED = "# Edited\n\nbody";

  async function editing() {
    const rendered = await renderOpenedCanvas();
    fireEvent.doubleClick(blockOption(0));
    const box = sourceBox() as HTMLTextAreaElement;
    await rendered.shell.user.clear(box);
    await rendered.shell.user.click(box);
    await rendered.shell.user.paste(EDITED);
    return { ...rendered, box };
  }

  it("commits the draft, keeps the editor, focus and caret, and adds no entry when repeated", async () => {
    const { shell, canvas, box } = await editing();
    const caret = [box.selectionStart, box.selectionEnd];

    expect(await press(box, CTRL)).toBe(false);

    const path = canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    expect(shell.gateway.files.get(path)).toBe(EDITED);
    expect(await canvas.undoDepth()).toBe(1);
    expect(sourceBox()).toBe(box);
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual(caret);

    await press(box, CTRL);
    expect(await canvas.undoDepth()).toBe(1);

    await shell.user.type(box, "!");
    expect(box.value).toBe(`${EDITED}!`);
    await press(box, META);
    expect(shell.gateway.files.get(path)).toBe(`${EDITED}!`);
    expect(await canvas.undoDepth()).toBe(2);
  });
});

describe("Ctrl/Cmd+S while renaming in the tree", () => {
  it("does not commit the rename, keeps the input open and prevents the default", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    const row = screen.getByRole("treeitem", { name: "Document A" });
    row.focus();
    await shell.user.keyboard("{F2}");
    const input = screen.getByRole("textbox", {
      name: "Document Aの名前を変更",
    });
    await shell.user.keyboard("Typed");
    shell.gateway.clearCalls();

    expect(await press(input, CTRL)).toBe(false);

    expect(
      screen.getByRole("textbox", { name: "Document Aの名前を変更" }),
    ).toBe(input);
    expect((input as HTMLInputElement).value).toBe("Typed");
    expect(shell.gateway.savedDocumentNames).not.toContain("Typed");
    expect(writes(shell)).toEqual([]);
  });
});
