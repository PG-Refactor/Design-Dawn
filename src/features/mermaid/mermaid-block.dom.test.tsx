// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBlockAt, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import { BLOCK_ONE } from "../canvas/test-support/canvas-harness";
import {
  blockOption,
  canvasElement,
  pointer,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import {
  type ActionsHarness,
  seedSheetBlocks,
} from "../workspace/test-support/actions-harness";
import { setActiveSheet } from "../workspace/ui-state/ui-state";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import { MERMAID_BLOCK_DEFAULTS } from "./mermaid-block-defaults";
import { MERMAID_MESSAGES } from "./mermaid-messages";
import type { MermaidRenderer } from "./mermaid-renderer-types";
import {
  createFakeRenderer,
  type FakeMermaidRenderer,
  installObjectUrlFake,
  type ObjectUrlFake,
} from "./test-support/fake-mermaid-renderer";

let objectUrls: ObjectUrlFake;

beforeEach(() => {
  objectUrls = installObjectUrlFake();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  objectUrls.restore();
});

const MESSAGES = MERMAID_MESSAGES.ja;
const SEEDED_SOURCE = "flowchart LR\n  X --> Y";
const EDITED = "sequenceDiagram\n  A->>B: hi";
const CANVAS_AREA = { width: 800, height: 600 };
const MERMAID_OPTION = 0;

// Block 1 of sheet A1 becomes a Mermaid block; blocks 2 and 3 stay Markdown.
function seedMermaid(source: string = SEEDED_SOURCE) {
  return (harness: ActionsHarness): void => {
    const blocks = [
      makeBlockAt(1, 10, 20, "mermaid"),
      makeBlockAt(2, 300, 40),
      makeBlockAt(3, 0, 200),
    ];
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
    harness.gateway.files.set(blocks[0]?.contentPath ?? "", source);
  };
}

// The renderer is a fake: these tests are about the block (states, editing, saving), not
// about Mermaid. The real library is covered by render-mermaid.real.dom.test.ts.
const opened = (
  source?: string,
  renderer: MermaidRenderer = createFakeRenderer(),
) => renderOpenedCanvas(seedMermaid(source), { mermaidRenderer: renderer });
type Rendered = Awaited<ReturnType<typeof opened>>;

const diagramOf = (shortId = "00000001") =>
  within(previewOf(shortId)).getByRole("img", {
    name: MESSAGES.diagramAlt(shortId),
  }) as HTMLImageElement;
const lastSource = (renderer: FakeMermaidRenderer) =>
  renderer.calls.at(-1)?.source;

const previewOf = (shortId = "00000001") =>
  screen.getByRole("region", { name: MESSAGES.previewLabel(shortId) });
const sourceBox = (shortId = "00000001") =>
  screen.getByRole("textbox", {
    name: MESSAGES.sourceLabel(shortId),
  }) as HTMLTextAreaElement;

async function startEditing() {
  fireEvent.doubleClick(blockOption(MERMAID_OPTION));
  return sourceBox();
}

async function typeInto(
  shell: Rendered["shell"],
  box: HTMLElement,
  text: string,
) {
  await shell.user.clear(box);
  await shell.user.click(box);
  await shell.user.paste(text);
}

async function press(init: KeyboardEventInit) {
  await act(async () => {
    fireEvent.keyDown(canvasElement(), init);
    await settle();
  });
}

function stubCanvasArea(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...CANVAS_AREA,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: CANVAS_AREA.width,
    bottom: CANVAS_AREA.height,
    toJSON: () => ({}),
  });
}

describe("creating a Mermaid block", () => {
  it("is offered by the + Block menu and creates one block with the default source in one undo step", async () => {
    stubCanvasArea();
    const { shell, canvas } = await renderOpenedCanvas();
    shell.gateway.clearCalls();

    await shell.user.click(screen.getByRole("button", { name: "+ Block" }));
    await shell.user.click(screen.getByRole("menuitem", { name: "Mermaid" }));
    await act(settle);

    const created = canvas.blocksOfSheetA1().at(-1);
    expect(created?.blockType).toBe("mermaid");
    expect(created?.size).toEqual(MERMAID_BLOCK_DEFAULTS.size);
    expect(
      canvas.session.getState().contents.get(created?.blockId ?? BLOCK_ONE),
    ).toBe(MERMAID_BLOCK_DEFAULTS.initialText);
    expect(
      shell.gateway.calls.filter(
        (call) => call.method === "createBlockContent",
      ),
    ).toEqual([{ method: "createBlockContent", detail: "mermaid" }]);
    expect(await canvas.undoDepth()).toBe(1);
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });
});

describe("a Mermaid block outside edit mode", () => {
  it("shows the rendered diagram as an image, not markup in the page", async () => {
    const renderer = createFakeRenderer();
    await opened(undefined, renderer);
    const image = await screen.findByRole("img", {
      name: MESSAGES.diagramAlt("00000001"),
    });
    expect(image.getAttribute("src")).toMatch(/^blob:fake-/);
    expect(renderer.calls.map((call) => call.source)).toEqual([SEEDED_SOURCE]);
    // The SVG is the image's content only: nothing of it is in the page.
    expect(previewOf().querySelector("svg, text, pre")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows source that looks like markup, and an error message that does, as text only", async () => {
    const markup = "<img src=x onerror=alert(1)>";
    const renderer = createFakeRenderer((source) => ({
      ok: false,
      message: `Parse error near ${source}`,
    }));
    await opened(markup, renderer);
    const preview = previewOf();
    const detail = await within(preview).findByText(
      `Parse error near ${markup}`,
    );
    expect(detail.tagName).toBe("PRE");
    expect(detail.children).toHaveLength(0);
    expect(preview.querySelector("img")).toBeNull();
  });

  it("shows the failure with the hint to edit when there is no earlier diagram", async () => {
    const renderer = createFakeRenderer(() => ({
      ok: false,
      message: "Parse error on line 2",
    }));
    await opened(undefined, renderer);
    const preview = previewOf();
    expect(
      await within(preview).findByText(MESSAGES.renderFailed),
    ).toBeTruthy();
    expect(within(preview).getByText("Parse error on line 2")).toBeTruthy();
    expect(within(preview).getByText(MESSAGES.editHint)).toBeTruthy();
    expect(preview.querySelector("img")).toBeNull();
  });

  it("draws again with the new theme when the theme changes", async () => {
    const renderer = createFakeRenderer();
    const { shell } = await opened(undefined, renderer);
    await screen.findByRole("img", { name: MESSAGES.diagramAlt("00000001") });
    expect(renderer.calls).toHaveLength(1);
    const previous = objectUrls.created.length;

    await act(async () => {
      shell.services.themeController.applyExternal(
        shell.services.themeController.store.getState().resolvedTheme === "dark"
          ? "light"
          : "dark",
      );
      await settle();
    });

    await waitFor(() => expect(renderer.calls).toHaveLength(2));
    await waitFor(() => expect(objectUrls.created.length).toBe(previous + 1));
    // The old image is released once the new one replaces it.
    expect(objectUrls.live()).toHaveLength(1);
  });

  it("shows the empty message for an empty source and does not render", async () => {
    const renderer = createFakeRenderer();
    await opened("", renderer);
    const preview = previewOf();
    expect(within(preview).getByText(MESSAGES.empty)).toBeTruthy();
    expect(preview.querySelector("img")).toBeNull();
    expect(renderer.calls).toEqual([]);
  });

  it("shows an error state, not an empty diagram, when the source cannot be loaded", async () => {
    const { shell } = await renderOpenedCanvas((harness) => {
      seedMermaid()(harness);
      harness.gateway.files.delete(makeBlockAt(1, 0, 0, "mermaid").contentPath);
    });
    const failed = blockOption(MERMAID_OPTION);
    expect(within(failed).getByText(MESSAGES.loadFailed)).toBeTruthy();
    expect(within(failed).getByText("fileNotFound")).toBeTruthy();
    expect(within(failed).queryByRole("region")).toBeNull();
    fireEvent.doubleClick(failed);
    expect(shell.uiStateStore.getState().editingBlock).toBeNull();
  });

  it("opens the shared editor on Enter when it is the only selected block", async () => {
    await opened();
    fireEvent.pointerDown(blockOption(MERMAID_OPTION), pointer(5, 5));
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));
    await press({ key: "Enter" });
    expect(sourceBox()).toBeTruthy();
  });
});

describe("editing a Mermaid block", () => {
  it("opens the shared editor with the Mermaid labels and the diagram as preview", async () => {
    const renderer = createFakeRenderer();
    await opened(undefined, renderer);
    const box = await startEditing();
    expect(box.value).toBe(SEEDED_SOURCE);
    expect(
      screen.getByRole("group", { name: MESSAGES.editorLabel("00000001") }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: MESSAGES.done })).toBeTruthy();
    expect((await screen.findAllByRole("img")).length).toBeGreaterThan(0);
    expect(lastSource(renderer)).toBe(SEEDED_SOURCE);
    // No hint to double-click: the editor is already open.
    expect(screen.queryByText(MESSAGES.editHint)).toBeNull();
    expect(document.activeElement).toBe(box);
  });

  it("changes only the draft while typing: no store update, history entry or I/O", async () => {
    const renderer = createFakeRenderer();
    const { shell, canvas } = await opened(undefined, renderer);
    const box = await startEditing();
    const storeBefore = shell.store.getState();
    const callsBefore = shell.gateway.methods().length;

    await typeInto(shell, box, EDITED);

    expect(box.value).toBe(EDITED);
    // The preview follows the draft once typing pauses (debounced).
    await waitFor(() => expect(lastSource(renderer)).toBe(EDITED));
    expect(shell.store.getState()).toBe(storeBefore);
    expect(canvas.session.getState().history.canUndo).toBe(false);
    expect(shell.gateway.methods()).toHaveLength(callsBefore);
    expect(shell.scheduler.pendingCount()).toBe(0);
  });

  it("commits one editBlockContent when focus goes outside; undo and redo switch the source", async () => {
    const renderer = createFakeRenderer();
    const { shell, canvas } = await opened(undefined, renderer);
    const box = await startEditing();
    await typeInto(shell, box, EDITED);

    await shell.user.click(canvasElement());
    await act(settle);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(canvas.session.getState().history.undoLabel).toBe(
      "editBlockContent",
    );
    expect(canvas.session.getState().contents.get(BLOCK_ONE)).toBe(EDITED);
    // The normal view draws the committed text at once.
    await waitFor(() => expect(lastSource(renderer)).toBe(EDITED));
    expect(diagramOf()).toBeTruthy();
    expect(await canvas.undoDepth()).toBe(1);

    await press({ key: "z", ctrlKey: true });
    await waitFor(() => expect(lastSource(renderer)).toBe(SEEDED_SOURCE));
    await press({ key: "y", ctrlKey: true });
    await waitFor(() => expect(lastSource(renderer)).toBe(EDITED));
  });

  it("is saved by the auto-save as one writeBlockContent and no sheet save", async () => {
    const { shell, canvas } = await opened();
    const box = await startEditing();
    await typeInto(shell, box, EDITED);
    await shell.user.click(screen.getByRole("button", { name: MESSAGES.done }));
    await act(settle);
    expect(shell.gateway.methods("writeBlockContent")).toEqual([]);

    await shell.runAutoSave();

    expect(shell.gateway.methods("writeBlockContent")).toHaveLength(1);
    expect(shell.gateway.methods("saveSheet")).toEqual([]);
    const block = canvas.blocksOfSheetA1()[0];
    expect(shell.gateway.files.get(block?.contentPath ?? "")).toBe(EDITED);
  });

  it("stays unsaved with auto-save off until Ctrl+S commits the draft and writes it", async () => {
    const { shell, canvas } = await opened();
    await act(async () => {
      await shell.autoSaveController.setEnabled(false);
    });
    const box = await startEditing();
    await typeInto(shell, box, EDITED);
    const path = canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    await shell.runAutoSave();
    expect(shell.gateway.files.get(path)).toBe(SEEDED_SOURCE);

    await act(async () => {
      fireEvent.keyDown(box, { key: "s", ctrlKey: true });
      await settle();
    });

    expect(shell.gateway.files.get(path)).toBe(EDITED);
    expect(await canvas.undoDepth()).toBe(1);
    // Saving does not close the editor or move the focus.
    expect(sourceBox()).toBe(box);
    expect(document.activeElement).toBe(box);
  });

  it("commits the draft without closing the editor on save all, once", async () => {
    const { shell, canvas } = await opened();
    const box = await startEditing();
    await typeInto(shell, box, EDITED);

    const result = await act(() => shell.services.actions.saveAll());
    await act(async () => {
      await shell.services.actions.saveAll();
    });

    expect(result.ok).toBe(true);
    const path = canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    expect(shell.gateway.files.get(path)).toBe(EDITED);
    expect(await canvas.undoDepth()).toBe(1);
    expect(sourceBox()).toBe(box);
    expect(shell.uiStateStore.getState().editingBlock).not.toBeNull();
  });

  it("commits the draft when the sheet is switched without a focus change", async () => {
    const { shell, canvas } = await opened();
    const box = await startEditing();
    await typeInto(shell, box, EDITED);

    await act(async () => {
      shell.uiStateStore.setState((state) =>
        setActiveSheet(state, DOCUMENT_A, SHEET_A2),
      );
      await settle();
    });

    expect(canvas.session.getState().contents.get(BLOCK_ONE)).toBe(EDITED);
    expect(shell.uiStateStore.getState().editingBlock).toBeNull();
    expect(await canvas.undoDepth()).toBe(1);
  });
});

describe("closing the document with a pending Mermaid draft and auto-save off", () => {
  const TEXTS = WORKSPACE_MESSAGES.ja.dialogs.confirmUnsavedClose;
  const WRITE_METHODS = [
    "saveProject",
    "saveDocument",
    "saveSheet",
    "writeBlockContent",
  ] as const;

  async function pendingDraft() {
    const rendered = await opened();
    await act(async () => {
      await rendered.shell.autoSaveController.setEnabled(false);
    });
    const path = rendered.canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    const box = await startEditing();
    await typeInto(rendered.shell, box, EDITED);
    rendered.shell.gateway.clearCalls();
    return { ...rendered, path };
  }

  it("asks for confirmation, and discarding drops the draft without writing", async () => {
    const { shell, path } = await pendingDraft();
    expect(shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(true);

    await act(async () => {
      await shell.actions.closeDocument(DOCUMENT_A);
      await settle();
    });
    expect(
      within(screen.getByRole("dialog")).getByText(TEXTS.body),
    ).toBeTruthy();
    await act(async () => {
      await shell.actions.answerUnsavedClose("discard");
      await settle();
    });

    expect(shell.workspace.getDocumentSession(DOCUMENT_A)).toBeNull();
    expect(shell.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(shell.gateway.files.get(path)).toBe(SEEDED_SOURCE);
    expect(shell.uiStateStore.getState().operationErrors).toEqual([]);
  });
});

describe("Mermaid blocks on the canvas", () => {
  it("is deleted by Delete and brought back by undo with its source", async () => {
    const renderer = createFakeRenderer();
    const { canvas } = await opened(undefined, renderer);
    fireEvent.pointerDown(blockOption(MERMAID_OPTION), pointer(5, 5));
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));

    await press({ key: "Delete" });
    expect(canvas.blocksOfSheetA1()).toHaveLength(2);

    await press({ key: "z", ctrlKey: true });
    expect(canvas.blocksOfSheetA1()).toHaveLength(3);
    await waitFor(() => expect(diagramOf()).toBeTruthy());
    expect(lastSource(renderer)).toBe(SEEDED_SOURCE);
  });

  it("is copied and pasted with its type and source", async () => {
    const { canvas } = await opened();
    fireEvent.pointerDown(blockOption(MERMAID_OPTION), pointer(5, 5));
    fireEvent.pointerUp(canvasElement(), pointer(5, 5));

    await press({ key: "c", ctrlKey: true });
    await press({ key: "v", ctrlKey: true });

    const pasted = canvas.blocksOfSheetA1().at(-1);
    expect(canvas.blocksOfSheetA1()).toHaveLength(4);
    expect(pasted?.blockType).toBe("mermaid");
    expect(
      canvas.session.getState().contents.get(pasted?.blockId ?? BLOCK_ONE),
    ).toBe(SEEDED_SOURCE);
    expect(await canvas.undoDepth()).toBe(1);
  });
});
