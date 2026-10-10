// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationStore } from "../../application/state/application-state";
import {
  createFakeScheduler,
  createSequentialIdGenerator,
  settle,
  textOf,
} from "../../application/test-support/fakes";
import { TEST_AUTO_SAVE_DELAY_MS } from "../../application/test-support/session-harness";
import {
  DOCUMENT_A,
  SELECTION_ID,
  SHEET_A1,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import { createWorkspace } from "../../application/workspace/workspace";
import { RESIZE_HANDLE_ATTRIBUTE } from "../canvas/block-dom";
import { BLOCK_ONE, BLOCK_TWO } from "../canvas/test-support/canvas-harness";
import { setActiveSheet } from "../workspace/ui-state/ui-state";
import { selectNotifications } from "../workspace/view-models/notifications-model";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import {
  blockOption,
  canvasElement,
  pointer,
  previewOf,
  renderOpenedCanvas,
  sourceBox,
} from "./test-support/markdown-harness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EDITED = "# Edited\n\nbody";

async function enterEditByDoubleClick(index = 0) {
  fireEvent.doubleClick(blockOption(index));
  return sourceBox();
}

async function typeInto(
  shell: Awaited<ReturnType<typeof renderOpenedCanvas>>["shell"],
  box: HTMLElement,
  text: string,
) {
  await shell.user.clear(box);
  // paste() inserts the text as one input, so `#` and newlines need no key syntax.
  await shell.user.click(box);
  await shell.user.paste(text);
}

describe("content loading", () => {
  it("shows the loaded text as a rendered preview once the sheet is visible", async () => {
    const { shell } = await renderOpenedCanvas();
    expect(previewOf("00000001").textContent).toContain(textOf(BLOCK_ONE));
    expect(previewOf("00000002").textContent).toContain(textOf(BLOCK_TWO));
    expect(shell.gateway.methods("readBlockContent")).toHaveLength(3);
    // The normal state shows no source.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders Markdown (heading, emphasis) instead of its source", async () => {
    await renderOpenedCanvas((harness) => {
      for (const path of harness.gateway.files.keys()) {
        harness.gateway.files.set(path, "# Heading\n\n**bold**");
      }
    });
    const preview = previewOf("00000001");
    expect(preview.querySelector("h1")?.textContent).toBe("Heading");
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
  });

  it("shows empty content and Japanese content", async () => {
    await renderOpenedCanvas((harness) => {
      const paths = [...harness.gateway.files.keys()];
      harness.gateway.files.set(paths[0] ?? "", "");
      harness.gateway.files.set(paths[1] ?? "", "# 日本語のメモ\n\n本文です。");
    });
    expect(previewOf("00000001").textContent).toBe("");
    expect(previewOf("00000002").querySelector("h1")?.textContent).toBe(
      "日本語のメモ",
    );
  });

  it("shows a missing file as an error state, not an empty preview", async () => {
    const { shell } = await renderOpenedCanvas((harness) => {
      const path = [...harness.gateway.files.keys()][0] ?? "";
      harness.gateway.files.delete(path);
    });
    const failed = blockOption(0);
    expect(within(failed).getByText("本文を読み込めませんでした")).toBeTruthy();
    expect(within(failed).getByText("fileNotFound")).toBeTruthy();
    expect(within(failed).queryByRole("region")).toBeNull();
    // The other blocks are unaffected.
    expect(previewOf("00000002")).toBeTruthy();

    // It cannot be edited ...
    fireEvent.doubleClick(failed);
    fireEvent.pointerDown(failed, pointer(1, 1));
    fireEvent.pointerUp(canvasElement(), pointer(1, 1));
    fireEvent.keyDown(canvasElement(), { key: "Enter" });
    expect(shell.uiStateStore.getState().editingBlock).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();

    // ... and is listed as a warning.
    const model = selectNotifications({
      messages: WORKSPACE_MESSAGES.ja,
      application: shell.store.getState(),
      operationErrors: [],
      theme: { loadIssue: null, saveError: null },
    });
    expect(
      model.items.filter((item) => item.kind === "contentLoadFailed"),
    ).toHaveLength(1);
    expect(
      model.items.find((item) => item.kind === "contentLoadFailed")?.severity,
    ).toBe("warning");
  });

  it("shows a read failure as an error state too", async () => {
    await renderOpenedCanvas((harness) => {
      harness.gateway.failOn("readBlockContent", "ioError");
    });
    const failed = blockOption(0);
    expect(within(failed).getByText("本文を読み込めませんでした")).toBeTruthy();
    expect(within(failed).getByText("ioError")).toBeTruthy();
  });

  it("keeps a block with missing content selectable, movable and deletable", async () => {
    const { shell, canvas } = await renderOpenedCanvas((harness) => {
      harness.gateway.files.delete([...harness.gateway.files.keys()][0] ?? "");
    });
    fireEvent.pointerDown(blockOption(0), pointer(100, 100));
    fireEvent.pointerMove(canvasElement(), {
      ...pointer(130, 100),
      altKey: true,
    });
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(130, 100));
      await settle();
    });
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 40, y: 20 });
    expect(blockOption(0).getAttribute("aria-selected")).toBe("true");

    // A block whose content file is gone must still be removable (there is nothing on
    // disk to lose); undo brings back the block in the same "content missing" state.
    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "Delete" });
      await settle();
    });
    expect(canvas.blocksOfSheetA1()).toHaveLength(2);
    expect(shell.uiStateStore.getState().operationErrors).toEqual([]);

    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "z", ctrlKey: true });
      await settle();
    });
    expect(canvas.blocksOfSheetA1()).toHaveLength(3);
  });
});

describe("entering edit mode", () => {
  it("opens the split view on double-click, with the source in a named textarea", async () => {
    await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    expect((box as HTMLTextAreaElement).value).toBe(textOf(BLOCK_ONE));
    expect(
      screen.getByRole("group", { name: "Markdown編集（00000001）" }),
    ).toBeTruthy();
    expect(previewOf("00000001").textContent).toContain(textOf(BLOCK_ONE));
    expect(screen.getByRole("button", { name: "完了" })).toBeTruthy();
    // Focus moved into the source.
    expect(document.activeElement).toBe(box);
    // Other blocks keep showing only their preview.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  describe("when the dblclick is aimed at the canvas itself (WebKitGTK pointer capture)", () => {
    // After the canvas captured the pointer on pointerdown, WebKitGTK dispatches the
    // dblclick to the canvas; only its coordinates still point at the block. jsdom has no
    // elementFromPoint, so each test supplies the hit test.
    const BLOCK_POINT = { clientX: 40, clientY: 30 };
    function hitTestReturns(element: () => Element | null) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: (x: number, y: number) =>
          x === BLOCK_POINT.clientX && y === BLOCK_POINT.clientY
            ? element()
            : null,
      });
    }
    const resizeHandleOf = (option: HTMLElement) =>
      option.parentElement?.querySelector(
        `[${RESIZE_HANDLE_ATTRIBUTE}]`,
      ) as Element;
    afterEach(() => {
      Reflect.deleteProperty(document, "elementFromPoint");
    });

    it("opens the block under the pointer, found from an inner element", async () => {
      await renderOpenedCanvas();
      hitTestReturns(() => previewOf("00000002"));
      fireEvent.doubleClick(canvasElement(), BLOCK_POINT);
      const box = sourceBox("00000002");
      expect(document.activeElement).toBe(box);
      expect(screen.getAllByRole("textbox")).toHaveLength(1);
    });

    it("does nothing without a block under the pointer", async () => {
      await renderOpenedCanvas();
      for (const hit of [
        () => null,
        () => canvasElement(),
        // Outside this canvas.
        () => document.body,
      ]) {
        hitTestReturns(hit);
        fireEvent.doubleClick(canvasElement(), BLOCK_POINT);
        expect(screen.queryByRole("textbox")).toBeNull();
      }
    });

    it("does nothing for the resize handle under the pointer", async () => {
      await renderOpenedCanvas();
      hitTestReturns(() => resizeHandleOf(blockOption(0)));
      fireEvent.doubleClick(canvasElement(), BLOCK_POINT);
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });

  it("opens on Enter when exactly one Markdown block is selected", async () => {
    await renderOpenedCanvas();
    fireEvent.pointerDown(blockOption(1), pointer(5, 5));
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));
    fireEvent.keyDown(canvasElement(), { key: "Enter" });
    expect(sourceBox("00000002")).toBeTruthy();
  });

  it("does not open on Enter with no selection or with several blocks selected", async () => {
    await renderOpenedCanvas();
    fireEvent.keyDown(canvasElement(), { key: "Enter" });
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.pointerDown(blockOption(0), pointer(5, 5));
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));
    fireEvent.pointerDown(blockOption(1), { ...pointer(5, 5), ctrlKey: true });
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));
    fireEvent.keyDown(canvasElement(), { key: "Enter" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("typing", () => {
  it("changes only the draft and the preview: no store update, history entry or I/O", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    const storeBefore = shell.store.getState();
    const callsBefore = shell.gateway.methods().length;

    await typeInto(shell, box, EDITED);

    expect((box as HTMLTextAreaElement).value).toBe(EDITED);
    expect(previewOf("00000001").querySelector("h1")?.textContent).toBe(
      "Edited",
    );
    expect(shell.store.getState()).toBe(storeBefore);
    expect(canvas.session.getState().history.canUndo).toBe(false);
    expect(shell.gateway.methods()).toHaveLength(callsBefore);
    expect(shell.scheduler.pendingCount()).toBe(0);
  });
});

describe("focus inside the editor does not end editing", () => {
  it("survives textarea -> preview click and textarea -> 完了 focus", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);

    await shell.user.click(previewOf("00000001"));
    await act(settle);
    expect(screen.queryByRole("textbox")).not.toBeNull();
    expect(canvas.session.getState().history.canUndo).toBe(false);

    await shell.user.click(box);
    await shell.user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "完了" }),
    );
    await act(settle);
    expect(screen.queryByRole("textbox")).not.toBeNull();
    expect(canvas.session.getState().history.canUndo).toBe(false);
    expect((box as HTMLTextAreaElement).value).toBe(EDITED);
  });
});

describe("the window losing focus", () => {
  it("does not end editing (focus is still on the textarea; the page lost it)", async () => {
    const { canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    fireEvent.blur(box, { relatedTarget: null });
    await act(settle);
    expect(screen.queryByRole("textbox")).not.toBeNull();
    expect(canvas.session.getState().history.canUndo).toBe(false);
  });
});

describe("committing", () => {
  it("commits exactly one editBlockContent entry when focus goes outside, then shows the new preview", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);

    await shell.user.click(canvasElement());
    await act(settle);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(shell.uiStateStore.getState().editingBlock).toBeNull();
    expect(canvas.session.getState().history.undoLabel).toBe(
      "editBlockContent",
    );
    expect(canvas.session.getState().contents.get(BLOCK_ONE)).toBe(EDITED);
    expect(previewOf("00000001").querySelector("h1")?.textContent).toBe(
      "Edited",
    );
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("commits with the 完了 button and returns focus to the block", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);

    await shell.user.click(screen.getByRole("button", { name: "完了" }));
    await act(settle);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(canvas.session.getState().contents.get(BLOCK_ONE)).toBe(EDITED);
    expect(canvas.session.getState().history.undoLabel).toBe(
      "editBlockContent",
    );
    expect(document.activeElement).toBe(blockOption(0));
  });

  it("creates no history entry when the text is unchanged", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    await enterEditByDoubleClick();
    await shell.user.click(screen.getByRole("button", { name: "完了" }));
    await act(settle);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(canvas.session.getState().history.canUndo).toBe(false);
  });

  it("undo shows the original preview, redo the edited one", async () => {
    const { shell } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    await shell.user.click(screen.getByRole("button", { name: "完了" }));
    await act(settle);

    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "z", ctrlKey: true });
      await settle();
    });
    expect(previewOf("00000001").textContent).toContain(textOf(BLOCK_ONE));
    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "y", ctrlKey: true });
      await settle();
    });
    expect(previewOf("00000001").querySelector("h1")?.textContent).toBe(
      "Edited",
    );
  });

  it("is saved by the auto-save as one writeBlockContent and no sheet save", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    await shell.user.click(screen.getByRole("button", { name: "完了" }));
    await act(settle);
    expect(shell.gateway.methods("writeBlockContent")).toEqual([]);

    await shell.runAutoSave();
    expect(shell.gateway.methods("writeBlockContent")).toHaveLength(1);
    expect(shell.gateway.methods("saveSheet")).toEqual([]);
    const block = canvas.blocksOfSheetA1()[0];
    expect(shell.gateway.files.get(block?.contentPath ?? "")).toBe(EDITED);
  });

  it("is restored by a new session over the same disk", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    await shell.user.click(screen.getByRole("button", { name: "完了" }));
    await act(settle);
    await shell.runAutoSave();

    const reopened = createWorkspace({
      gateway: shell.gateway,
      scheduler: createFakeScheduler(),
      idGenerator: createSequentialIdGenerator(),
      store: createApplicationStore(),
      config: {
        undoHistoryLimit: 50,
        autoSaveDelayMs: TEST_AUTO_SAVE_DELAY_MS,
      },
    });
    await reopened.openProject(SELECTION_ID);
    await reopened.openDocument(DOCUMENT_A);
    const session = reopened.getDocumentSession(DOCUMENT_A);
    await session?.loadSheetContents(SHEET_A1);
    expect(session?.getState().contents.get(BLOCK_ONE)).toBe(EDITED);
    expect(canvas.blocksOfSheetA1()).toHaveLength(3);
  });

  it("stays in edit mode with the draft when the commit fails, and records the error", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    // A closed session rejects every command (notWritable).
    await canvas.session.close();

    await shell.user.click(canvasElement());
    await act(settle);

    expect((sourceBox() as HTMLTextAreaElement).value).toBe(EDITED);
    expect(shell.uiStateStore.getState().editingBlock).not.toBeNull();
    expect(shell.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "editBlockContent", error: { kind: "notWritable" } },
    ]);
  });
});

describe("save all while editing", () => {
  function caretOf(box: HTMLElement) {
    const textarea = box as HTMLTextAreaElement;
    return [textarea.selectionStart, textarea.selectionEnd];
  }

  it("commits the draft as one entry and writes it, leaving the editor, focus and caret alone", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    const caret = caretOf(box);

    const result = await act(() => shell.services.actions.saveAll());

    expect(result.ok).toBe(true);
    const path = canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    expect(shell.gateway.files.get(path)).toBe(EDITED);
    expect(canvas.session.getState().history.undoLabel).toBe(
      "editBlockContent",
    );
    expect(await canvas.undoDepth()).toBe(1);
    expect(sourceBox()).toBe(box);
    expect((box as HTMLTextAreaElement).value).toBe(EDITED);
    expect(shell.uiStateStore.getState().editingBlock).not.toBeNull();
    expect(document.activeElement).toBe(box);
    expect(caretOf(box)).toEqual(caret);
  });

  it("adds no history entry when saved again without new typing", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    await act(async () => {
      await shell.services.actions.saveAll();
    });
    await act(async () => {
      await shell.services.actions.saveAll();
    });
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("no longer reaches an editor that was unmounted by a sheet switch", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    await act(async () => {
      shell.uiStateStore.setState((state) =>
        setActiveSheet(state, DOCUMENT_A, SHEET_A2),
      );
      await settle();
    });
    expect(await canvas.undoDepth()).toBe(1);
    const commit = vi.spyOn(shell.services.canvasActions, "commitContentEdit");

    await act(async () => {
      await shell.services.actions.saveAll();
    });

    expect(commit).not.toHaveBeenCalled();
    expect(await canvas.undoDepth()).toBe(1);
  });

  it("returns the error and keeps the editor open with the draft when the commit fails", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    await canvas.session.close();

    const result = await act(() => shell.services.actions.saveAll());

    expect(result.ok).toBe(false);
    expect(!result.ok && result?.error.kind).toBe("notWritable");
    expect((sourceBox() as HTMLTextAreaElement).value).toBe(EDITED);
    expect(shell.uiStateStore.getState().editingBlock).not.toBeNull();
  });
});

describe("leaving the sheet or the document while editing", () => {
  it("commits the draft when the sheet is switched without a focus change", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);

    await act(async () => {
      shell.uiStateStore.setState((state) =>
        setActiveSheet(state, DOCUMENT_A, SHEET_A2),
      );
      await settle();
    });

    expect(canvas.session.getState().contents.get(BLOCK_ONE)).toBe(EDITED);
    expect(shell.uiStateStore.getState().editingBlock).toBeNull();
    expect(canvas.session.getState().history.undoLabel).toBe(
      "editBlockContent",
    );
  });

  it("commits when a sheet tab is clicked", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    await shell.user.click(screen.getByRole("tab", { name: "Sheet A2" }));
    await act(settle);
    expect(canvas.session.getState().contents.get(BLOCK_ONE)).toBe(EDITED);
  });

  it("commits before the document is closed, so the closing save writes it", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    const path = canvas.blocksOfSheetA1()[0]?.contentPath ?? "";

    await shell.user.click(
      screen.getByRole("button", { name: "Document Aを閉じる" }),
    );
    await act(settle);

    expect(shell.workspace.getDocumentSession(DOCUMENT_A)).toBeNull();
    expect(shell.gateway.files.get(path)).toBe(EDITED);
    expect(shell.uiStateStore.getState().operationErrors).toEqual([]);
  });
});

describe("the canvas leaves an editing block alone", () => {
  it("does not select, drag or focus the canvas for pointer events inside the editor", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    const selectionBefore = shell.uiStateStore.getState().selectionBySheet;

    fireEvent.pointerDown(box, pointer(50, 50));
    fireEvent.pointerMove(canvasElement(), pointer(150, 150));
    expect(shell.uiStateStore.getState().interaction.kind).toBe("idle");
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(150, 150));
      await settle();
    });

    expect(shell.uiStateStore.getState().selectionBySheet).toBe(
      selectionBefore,
    );
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 10, y: 20 });
    expect(canvas.session.getState().history.canUndo).toBe(false);
    expect(document.activeElement).toBe(box);
  });

  it("lets Delete and Backspace edit text instead of deleting the block", async () => {
    const { canvas } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    // fireEvent returns false when the default action was prevented.
    expect(fireEvent.keyDown(box, { key: "Delete" })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Backspace" })).toBe(true);
    expect(
      fireEvent.keyDown(screen.getByRole("button", { name: "完了" }), {
        key: "Delete",
      }),
    ).toBe(true);
    await act(settle);
    expect(canvas.blocksOfSheetA1()).toHaveLength(3);
  });

  it("leaves Ctrl+Z / Ctrl+Y to the textarea instead of the application history", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    // Something to undo, so a wrongly handled Ctrl+Z would be visible.
    await canvas.canvasActions.commitDrag({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [BLOCK_TWO],
      worldDelta: { x: 20, y: 0 },
    });
    await act(settle);
    const box = await enterEditByDoubleClick();
    const undoLabelBefore = canvas.session.getState().history.undoLabel;

    expect(fireEvent.keyDown(box, { key: "z", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "y", ctrlKey: true })).toBe(true);
    expect(
      fireEvent.keyDown(box, { key: "Z", ctrlKey: true, shiftKey: true }),
    ).toBe(true);
    await act(settle);
    expect(canvas.session.getState().history.undoLabel).toBe(undoLabelBefore);
    expect(canvas.session.getState().history.canRedo).toBe(false);
    expect(shell.uiStateStore.getState().editingBlock).not.toBeNull();
  });

  it("lets Enter insert a newline (no canvas handling)", async () => {
    await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(true);
  });

  it("does not pan or zoom the canvas for a wheel over the editor", async () => {
    const { shell } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    const before = shell.uiStateStore.getState().viewportBySheet;

    // Not cancelled: the browser scrolls the textarea.
    expect(fireEvent.wheel(box, { deltaY: 120 })).toBe(true);
    expect(fireEvent.wheel(previewOf("00000001"), { deltaY: 120 })).toBe(true);
    // Ctrl + wheel is cancelled (no page zoom) but does not zoom the canvas.
    expect(fireEvent.wheel(box, { deltaY: -120, ctrlKey: true })).toBe(false);
    expect(shell.uiStateStore.getState().viewportBySheet).toBe(before);

    // Outside the editor the wheel still belongs to the canvas.
    fireEvent.wheel(canvasElement(), { deltaY: 30 });
    expect(shell.uiStateStore.getState().viewportBySheet).not.toBe(before);
  });

  it("does not let Escape discard the draft", async () => {
    const { shell } = await renderOpenedCanvas();
    const box = await enterEditByDoubleClick();
    await typeInto(shell, box, EDITED);
    fireEvent.keyDown(box, { key: "Escape" });
    expect((sourceBox() as HTMLTextAreaElement).value).toBe(EDITED);
  });
});

describe("a Markdown block outside edit mode", () => {
  it("is dragged from its preview content and moved as one undoable step", async () => {
    const { canvas } = await renderOpenedCanvas();
    fireEvent.pointerDown(previewOf("00000001"), pointer(100, 100));
    fireEvent.pointerMove(canvasElement(), {
      ...pointer(125, 110),
      altKey: true,
    });
    await act(async () => {
      fireEvent.pointerUp(canvasElement(), pointer(125, 110));
      await settle();
    });
    expect(canvas.blocksOfSheetA1()[0]?.position).toEqual({ x: 35, y: 30 });
    expect(await canvas.undoDepth()).toBe(1);
  });
});
