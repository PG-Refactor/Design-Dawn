// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationResult } from "../../application/ports/operation-error";
import { makeBlockAt, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { BLOCK_ONE } from "../canvas/test-support/canvas-harness";
import {
  blockOption,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import {
  type ActionsHarness,
  seedSheetBlocks,
} from "../workspace/test-support/actions-harness";
import { stopEditing } from "../workspace/ui-state/ui-state";
import { MERMAID_MESSAGES } from "./mermaid-messages";
import type { MermaidRenderer } from "./mermaid-renderer-types";
import {
  createDeferredRenderer,
  createFakeRenderer,
  installObjectUrlFake,
  type ObjectUrlFake,
} from "./test-support/fake-mermaid-renderer";
import { getShown } from "./test-support/reveal-in-gui";

// The pie GUI's uncommitted field values are drafts in the DraftRegistry, so
// save-all, the unsaved-close check, GUI -> Source and leaving the editor all see them.

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
const GUI = MESSAGES.gui;
const PIE = [
  "pie title Pets",
  '  "Dogs" : 386',
  '  "Cats" : 85',
  '  "Rats" : 15',
  "",
].join("\n");
const WRITE_METHODS = [
  "saveDocument",
  "saveSheet",
  "writeBlockContent",
] as const;
const SELECTED_ATTRIBUTE = "aria-selected";
const OK_SVG = "<svg xmlns='http://www.w3.org/2000/svg'/>";

function seedMermaid(source: string, secondSource?: string) {
  return (harness: ActionsHarness): void => {
    const blocks = [
      makeBlockAt(1, 10, 20, "mermaid"),
      makeBlockAt(
        2,
        300,
        40,
        secondSource === undefined ? "markdown" : "mermaid",
      ),
      makeBlockAt(3, 0, 200),
    ];
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
    harness.gateway.files.set(blocks[0]?.contentPath ?? "", source);
    if (secondSource !== undefined) {
      harness.gateway.files.set(blocks[1]?.contentPath ?? "", secondSource);
    }
  };
}

async function openGui(
  source: string = PIE,
  renderer: MermaidRenderer = createFakeRenderer(),
  options: { autoSave?: boolean; secondSource?: string } = {},
) {
  const rendered = await renderOpenedCanvas(
    seedMermaid(source, options.secondSource),
    { mermaidRenderer: renderer },
  );
  if (options.autoSave === false) {
    await act(async () => {
      await rendered.shell.autoSaveController.setEnabled(false);
    });
  }
  fireEvent.doubleClick(blockOption(0));
  await rendered.shell.user.click(getShown("button", GUI.modeGui));
  await act(settle);
  return rendered;
}
type Rendered = Awaited<ReturnType<typeof openGui>>;

const storedText = (rendered: Rendered): string | undefined =>
  rendered.canvas.session.getState().contents.get(BLOCK_ONE);
const textbox = (name: string) => getShown("textbox", name) as HTMLInputElement;
const button = (name: string) => getShown("button", name);
const alertText = () => screen.queryByRole("alert")?.textContent ?? null;
const option = (label: string, value: string) =>
  screen.getByRole("option", { name: GUI.sliceOption(label, value) });
const pending = (rendered: Rendered) =>
  rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A]);

// Typing without leaving the field: the value is a draft, nothing has blurred or committed.
function type(field: HTMLInputElement, text: string): void {
  fireEvent.change(field, { target: { value: text } });
}

async function pick(rendered: Rendered, label: string, value: string) {
  await rendered.shell.user.click(option(label, value));
}

async function saveAll(rendered: Rendered): Promise<OperationResult<void>> {
  let result: OperationResult<void> | undefined;
  await act(async () => {
    result = await rendered.shell.actions.saveAll();
    await settle();
  });
  if (result === undefined) throw new Error("saveAll did not finish");
  return result;
}

async function externalEdit(rendered: Rendered, text: string) {
  await act(async () => {
    await rendered.canvas.canvasActions.commitContentEdit({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockId: BLOCK_ONE,
      text,
    });
    await settle();
  });
}

describe("what counts as a pending GUI draft", () => {
  it("is the title field while its text differs from the committed title", async () => {
    const rendered = await openGui();
    expect(pending(rendered)).toBe(false);
    type(textbox(GUI.titleLabel), "Animals");
    expect(pending(rendered)).toBe(true);
    // Only blanks around the title are not a change.
    type(textbox(GUI.titleLabel), "  Pets ");
    expect(pending(rendered)).toBe(false);
    type(textbox(GUI.titleLabel), "Animals");
    await rendered.shell.user.type(textbox(GUI.titleLabel), "{Enter}");
    await act(settle);
    expect(pending(rendered)).toBe(false);
    expect(storedText(rendered)).toBe(PIE.replace("Pets", "Animals"));
  });

  it("is the label and the value of the selected slice until they are applied", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    expect(pending(rendered)).toBe(false);
    type(textbox(GUI.labelField), "Wolves");
    expect(pending(rendered)).toBe(true);
    type(textbox(GUI.labelField), "Dogs");
    expect(pending(rendered)).toBe(false);
    type(textbox(GUI.valueField), "400");
    expect(pending(rendered)).toBe(true);
    await rendered.shell.user.type(textbox(GUI.valueField), "{Enter}");
    await act(settle);
    expect(pending(rendered)).toBe(false);
    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
  });

  it("is any text in the add form, and only that document's", async () => {
    const rendered = await openGui();
    type(textbox(GUI.newLabelField), "Birds");
    expect(pending(rendered)).toBe(true);
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_B])).toBe(
      false,
    );
    type(textbox(GUI.newLabelField), "");
    expect(pending(rendered)).toBe(false);
    type(textbox(GUI.newValueField), "7");
    expect(pending(rendered)).toBe(true);
  });
});

describe("save-all (Ctrl/Cmd+S)", () => {
  it("commits a pending value as one history entry and writes it, with auto-save off", async () => {
    const rendered = await openGui(PIE, createFakeRenderer(), {
      autoSave: false,
    });
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "400");
    rendered.shell.gateway.clearCalls();

    const result = await saveAll(rendered);

    expect(result.ok).toBe(true);
    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
    expect(rendered.shell.gateway.methods(...WRITE_METHODS)).toContain(
      "writeBlockContent",
    );
    const path = rendered.canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    expect(rendered.shell.gateway.files.get(path)).toBe(
      PIE.replace("386", "400"),
    );
    expect(pending(rendered)).toBe(false);
  });

  it("commits a pending title and a pending new slice", async () => {
    const rendered = await openGui();
    type(textbox(GUI.titleLabel), "Animals");
    type(textbox(GUI.newLabelField), "Birds");
    type(textbox(GUI.newValueField), "7");

    expect((await saveAll(rendered)).ok).toBe(true);

    expect(storedText(rendered)).toBe(
      `${PIE.replace("Pets", "Animals")}  "Birds" : 7\n`,
    );
    expect(await rendered.canvas.undoDepth()).toBe(2);
    expect(pending(rendered)).toBe(false);
    expect(textbox(GUI.newLabelField).value).toBe("");
  });

  it("commits a label and a value together, value first", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.labelField), "Wolves");
    type(textbox(GUI.valueField), "9");

    expect((await saveAll(rendered)).ok).toBe(true);

    expect(storedText(rendered)).toBe(
      PIE.replace('"Dogs" : 386', '"Wolves" : 9'),
    );
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("fails on an invalid pending value, keeps the input and leaves the source alone", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "-1");

    const result = await saveAll(rendered);

    expect(result.ok).toBe(false);
    expect(storedText(rendered)).toBe(PIE);
    expect(await rendered.canvas.undoDepth()).toBe(0);
    expect(textbox(GUI.valueField).value).toBe("-1");
    expect(alertText()).toContain(GUI.refusalReasons.negativeValue);
    expect(pending(rendered)).toBe(true);
  });

  it("fails and keeps the source when Mermaid cannot draw the pending text", async () => {
    const renderer = createFakeRenderer((source) =>
      source.includes("Broken")
        ? { ok: false, message: "Parse error near Broken" }
        : { ok: true, svg: OK_SVG },
    );
    const rendered = await openGui(PIE, renderer);
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.labelField), "Broken");

    const result = await saveAll(rendered);

    expect(result.ok).toBe(false);
    expect(storedText(rendered)).toBe(PIE);
    expect(alertText()).toContain(GUI.refusalKinds.diagramRenderRejected);
    expect(textbox(GUI.labelField).value).toBe("Broken");
  });

  it("applies nothing when the block changed while its pending text was being drawn", async () => {
    const renderer = createDeferredRenderer();
    const rendered = await openGui(PIE, renderer);
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "400");
    const drawsBefore = renderer.pending.length;

    let result: OperationResult<void> | undefined;
    await act(async () => {
      void rendered.shell.actions.saveAll().then((value) => {
        result = value;
      });
      await settle();
    });
    await waitFor(() => expect(renderer.pending.length).toBe(drawsBefore + 1));
    const external = PIE.replace('"Dogs" : 386', '"Dogs" : 1');
    await externalEdit(rendered, external);
    await act(async () => {
      renderer.pending[drawsBefore]?.resolve({ ok: true, svg: OK_SVG });
      await settle();
    });
    await waitFor(() => expect(result).toBeDefined());

    expect(result?.ok).toBe(false);
    expect(storedText(rendered)).toBe(external);
    expect(alertText()).toContain(GUI.refusalKinds.staleContent);
  });
});

describe("closing with auto-save off", () => {
  async function closeWithPendingValue() {
    const rendered = await openGui(PIE, createFakeRenderer(), {
      autoSave: false,
    });
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "400");
    rendered.shell.gateway.clearCalls();
    return rendered;
  }

  it("asks about a pending GUI draft; 保存せずに閉じる discards it without a write or a later commit", async () => {
    const rendered = await closeWithPendingValue();
    const path = rendered.canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    const original = rendered.shell.gateway.files.get(path);
    expect(pending(rendered)).toBe(true);

    await act(async () => {
      await rendered.shell.actions.closeDocument(DOCUMENT_A);
      await settle();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => {
      await rendered.shell.actions.answerUnsavedClose("discard");
      await settle();
    });

    expect(screen.queryByRole("tab", { name: /Document A/ })).toBeNull();
    expect(rendered.shell.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(rendered.shell.gateway.files.get(path)).toBe(original);
    expect(rendered.shell.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("commits and saves the GUI draft on 保存して閉じる", async () => {
    const rendered = await closeWithPendingValue();
    const path = rendered.canvas.blocksOfSheetA1()[0]?.contentPath ?? "";

    await act(async () => {
      await rendered.shell.actions.closeDocument(DOCUMENT_A);
      await rendered.shell.actions.answerUnsavedClose("save");
      await settle();
    });

    expect(screen.queryByRole("tab", { name: /Document A/ })).toBeNull();
    expect(rendered.shell.gateway.files.get(path)).toBe(
      PIE.replace("386", "400"),
    );
  });

  it("does not ask when nothing is pending", async () => {
    const rendered = await openGui(PIE, createFakeRenderer(), {
      autoSave: false,
    });
    await pick(rendered, "Dogs", "386");
    await act(async () => {
      await rendered.shell.actions.closeDocument(DOCUMENT_A);
      await settle();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the item changed under a pending slice edit", () => {
  it("refuses the commit after an undo, keeps the input and changes nothing", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    await rendered.shell.user.clear(textbox(GUI.valueField));
    await rendered.shell.user.type(textbox(GUI.valueField), "400{Enter}");
    await act(settle);
    type(textbox(GUI.valueField), "999");

    await act(async () => {
      await rendered.canvas.session.undo();
      await settle();
    });
    expect(storedText(rendered)).toBe(PIE);
    // The user's text is not replaced by the undone value.
    expect(textbox(GUI.valueField).value).toBe("999");

    const result = await saveAll(rendered);

    expect(result.ok).toBe(false);
    expect(storedText(rendered)).toBe(PIE);
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
    expect(rendered.canvas.session.getState().history.canRedo).toBe(true);
    expect(textbox(GUI.valueField).value).toBe("999");
    expect(alertText()).toContain(GUI.itemChanged);
  });

  it("refuses to apply a label to another slice after the order changed", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.labelField), "Wolves");
    // A change from outside moves the slice to the end.
    const reordered = [
      "pie title Pets",
      '  "Cats" : 85',
      '  "Rats" : 15',
      '  "Dogs" : 386',
      "",
    ].join("\n");
    await externalEdit(rendered, reordered);

    const result = await saveAll(rendered);

    expect(result.ok).toBe(false);
    expect(storedText(rendered)).toBe(reordered);
    expect(textbox(GUI.labelField).value).toBe("Wolves");
    expect(alertText()).toContain(GUI.itemChanged);
  });

  it("keeps the text when the slice is gone, and the revert button discards it", async () => {
    const rendered = await openGui();
    await pick(rendered, "Rats", "15");
    type(textbox(GUI.valueField), "20");
    await externalEdit(rendered, PIE.replace('  "Rats" : 15\n', ""));

    expect(textbox(GUI.valueField).value).toBe("20");
    expect(screen.getByText(GUI.itemGone)).toBeTruthy();
    expect((await saveAll(rendered)).ok).toBe(false);
    expect(storedText(rendered)).toBe(PIE.replace('  "Rats" : 15\n', ""));

    await rendered.shell.user.click(button(GUI.revert));
    expect(pending(rendered)).toBe(false);
    expect(screen.queryByText(GUI.itemGone)).toBeNull();
    expect((await saveAll(rendered)).ok).toBe(true);
  });

  it("follows the committed text again when nothing was typed", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    await externalEdit(rendered, PIE.replace("386", "1"));
    expect(textbox(GUI.valueField).value).toBe("1");
    expect(pending(rendered)).toBe(false);
  });
});

describe("choosing another slice with a pending edit", () => {
  it("commits the edit first and then selects", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "400");

    await pick(rendered, "Cats", "85");
    await act(settle);

    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
    expect(option("Cats", "85").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("keeps the selection and shows the error when that commit fails", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "-1");

    await pick(rendered, "Cats", "85");
    await act(settle);

    expect(option("Dogs", "386").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    expect(option("Cats", "85").getAttribute(SELECTED_ATTRIBUTE)).toBe("false");
    expect(textbox(GUI.valueField).value).toBe("-1");
    expect(alertText()).toContain(GUI.refusalReasons.negativeValue);
    expect(storedText(rendered)).toBe(PIE);
  });
});

describe("switching between the GUI and Source", () => {
  it("commits pending GUI drafts before showing Source", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    // fireEvent does not move the focus, so only the switch itself can commit the draft.
    type(textbox(GUI.valueField), "400");
    fireEvent.click(button(GUI.modeSource));
    await act(settle);

    const box = screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel("00000001"),
    }) as HTMLTextAreaElement;
    expect(box.value).toBe(PIE.replace("386", "400"));
    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("stays in the GUI and shows the error when a pending draft is refused", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "-1");
    fireEvent.click(button(GUI.modeSource));
    await act(settle);

    expect(button(GUI.modeGui).getAttribute("aria-pressed")).toBe("true");
    expect(textbox(GUI.valueField).value).toBe("-1");
    expect(alertText()).toContain(GUI.refusalReasons.negativeValue);
    expect(storedText(rendered)).toBe(PIE);
  });
});

// Ends the edit the way a sheet switch does: the editor unmounts while the field still has
// its uncommitted text and no blur ever happened.
async function leaveEditorWithoutBlur(rendered: Rendered) {
  await act(async () => {
    rendered.shell.uiStateStore.setState((state) =>
      stopEditing(state, SHEET_A1, BLOCK_ONE),
    );
    await settle();
  });
}

describe("leaving the editor and other blocks", () => {
  const OTHER = 'pie\n  "Other" : 5\n';

  it("commits what is pending when the editor goes away, once", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "400");

    await leaveEditorWithoutBlur(rendered);

    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("reports a refused commit as a notification when the editor is already gone", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "-1");

    await leaveEditorWithoutBlur(rendered);

    // Nothing was applied, and the lost input is not silent.
    expect(storedText(rendered)).toBe(PIE);
    expect(await rendered.canvas.undoDepth()).toBe(0);
    expect(
      rendered.shell.uiStateStore
        .getState()
        .operationErrors.map((entry) => [entry.operation, entry.error.kind]),
    ).toEqual([["editDiagram", "invalidDiagramOperation"]]);
  });

  it("does not leak a draft into another Mermaid block", async () => {
    const rendered = await openGui(PIE, createFakeRenderer(), {
      secondSource: OTHER,
    });
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "400");
    type(textbox(GUI.titleLabel), "Leaked?");

    await leaveEditorWithoutBlur(rendered);
    fireEvent.doubleClick(blockOption(1));
    await rendered.shell.user.click(getShown("button", GUI.modeGui));
    await act(settle);

    expect(textbox(GUI.titleLabel).value).toBe("");
    expect(
      screen.getByRole("option", { name: GUI.sliceOption("Other", "5") }),
    ).toBeTruthy();
    expect(pending(rendered)).toBe(false);
    const second = rendered.canvas.session
      .getState()
      .contents.get(rendered.canvas.blocksOfSheetA1()[1]?.blockId ?? BLOCK_ONE);
    expect(second).toBe(OTHER);
    // Only the first block's own two drafts were committed (value and title).
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });
});

// Which trigger may commit what, and that one input is never applied twice.

const ENTER = { key: "Enter" };
const INVALID_VALUE = "-1";

// A same-tick "focus leaves the field" that stays inside the editor, so the editor itself
// keeps the edit (a real blur to the page would also end it).
function blurField(field: HTMLInputElement): void {
  fireEvent.focusOut(field, { relatedTarget: button(GUI.apply) });
}

function watchOperations(rendered: Rendered) {
  return vi.spyOn(rendered.canvas.canvasActions, "applyDiagramOperation");
}

const operationErrorsOf = (rendered: Rendered) =>
  rendered.shell.uiStateStore.getState().operationErrors;

describe("one input, one attempt", () => {
  it("Enter immediately followed by blur applies once", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    const attempts = watchOperations(rendered);
    type(textbox(GUI.valueField), "400");

    await act(async () => {
      fireEvent.keyDown(textbox(GUI.valueField), ENTER);
      blurField(textbox(GUI.valueField));
      await settle();
    });

    expect(attempts).toHaveBeenCalledTimes(1);
    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("does not repeat a refused Enter on blur, in the same tick or later", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    const attempts = watchOperations(rendered);
    type(textbox(GUI.valueField), INVALID_VALUE);

    await act(async () => {
      fireEvent.keyDown(textbox(GUI.valueField), ENTER);
      blurField(textbox(GUI.valueField));
      await settle();
    });
    expect(attempts).toHaveBeenCalledTimes(1);
    expect(alertText()).toContain(GUI.refusalReasons.negativeValue);

    await act(async () => {
      blurField(textbox(GUI.valueField));
      await settle();
    });
    expect(attempts).toHaveBeenCalledTimes(1);
    expect(textbox(GUI.valueField).value).toBe(INVALID_VALUE);
    // The refusal is still pending for save-all, which reports it without a new attempt.
    expect((await saveAll(rendered)).ok).toBe(false);
    expect(attempts).toHaveBeenCalledTimes(1);
    expect(storedText(rendered)).toBe(PIE);
  });

  it("Enter always tries again, even with the same refused input", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    const attempts = watchOperations(rendered);
    type(textbox(GUI.valueField), INVALID_VALUE);
    for (let round = 0; round < 2; round += 1) {
      await act(async () => {
        fireEvent.keyDown(textbox(GUI.valueField), ENTER);
        await settle();
      });
    }
    expect(attempts).toHaveBeenCalledTimes(2);
  });

  it("tries again on blur once the input was edited", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    const attempts = watchOperations(rendered);
    type(textbox(GUI.valueField), INVALID_VALUE);
    await act(async () => {
      fireEvent.keyDown(textbox(GUI.valueField), ENTER);
      await settle();
    });
    type(textbox(GUI.valueField), "-2");
    await act(async () => {
      blurField(textbox(GUI.valueField));
      await settle();
    });
    expect(attempts).toHaveBeenCalledTimes(2);
  });

  it("tries again on blur when the committed text changed under the same input", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    const attempts = watchOperations(rendered);
    // "Cats" is not the selected slice: the refused input stays the same, the text differs.
    type(textbox(GUI.valueField), INVALID_VALUE);
    await act(async () => {
      fireEvent.keyDown(textbox(GUI.valueField), ENTER);
      await settle();
    });
    await externalEdit(rendered, PIE.replace('Rats" : 15', 'Rats" : 16'));
    await act(async () => {
      blurField(textbox(GUI.valueField));
      await settle();
    });
    expect(attempts.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("applies once for Enter, blur, Apply and save-all in quick succession", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    const attempts = watchOperations(rendered);
    type(textbox(GUI.valueField), "400");

    await act(async () => {
      fireEvent.keyDown(textbox(GUI.valueField), ENTER);
      blurField(textbox(GUI.valueField));
      fireEvent.click(button(GUI.apply));
      void rendered.shell.actions.saveAll();
      await settle();
    });

    expect(attempts).toHaveBeenCalledTimes(1);
    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("refuses, then accepts the corrected input; a refusal changes nothing", async () => {
    const rendered = await openGui(PIE, createFakeRenderer(), {
      autoSave: false,
    });
    await pick(rendered, "Dogs", "386");
    rendered.shell.gateway.clearCalls();
    type(textbox(GUI.valueField), INVALID_VALUE);
    await act(async () => {
      fireEvent.keyDown(textbox(GUI.valueField), ENTER);
      await settle();
    });
    expect(storedText(rendered)).toBe(PIE);
    expect(rendered.shell.gateway.methods(...WRITE_METHODS)).toEqual([]);

    type(textbox(GUI.valueField), "400");
    await act(async () => {
      fireEvent.keyDown(textbox(GUI.valueField), ENTER);
      await settle();
    });
    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
    expect(alertText()).toBeNull();
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("never applies old input to a changed text or to another slice", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    const attempts = watchOperations(rendered);
    type(textbox(GUI.valueField), "400");
    // The slice the input belongs to is removed in Source while the user is typing.
    const external = PIE.replace('  "Dogs" : 386\n', "");
    await externalEdit(rendered, external);

    await act(async () => {
      blurField(textbox(GUI.valueField));
      await settle();
    });

    expect(storedText(rendered)).toBe(external);
    expect(attempts).not.toHaveBeenCalled();
    expect(textbox(GUI.valueField).value).toBe("400");
  });
});

describe("the add form", () => {
  const addedBirds = `${PIE}  "Birds" : 7\n`;

  it("never adds on tabbing between its fields, blur or a click elsewhere", async () => {
    const rendered = await openGui();
    const { user } = rendered.shell;
    await user.click(textbox(GUI.newLabelField));
    await user.keyboard("Birds");
    await user.tab();
    await user.keyboard("7");
    await user.tab();
    await user.click(
      screen.getByRole("group", { name: MESSAGES.editorLabel("00000001") }),
    );
    await act(settle);

    expect(storedText(rendered)).toBe(PIE);
    expect(textbox(GUI.newLabelField).value).toBe("Birds");
    expect(textbox(GUI.newValueField).value).toBe("7");
    expect(pending(rendered)).toBe(true);
    expect(await rendered.canvas.undoDepth()).toBe(0);
  });

  it("adds on Enter and on the Add button, undoable and redoable", async () => {
    const rendered = await openGui();
    type(textbox(GUI.newLabelField), "Birds");
    type(textbox(GUI.newValueField), "7");
    await act(async () => {
      fireEvent.keyDown(textbox(GUI.newValueField), ENTER);
      await settle();
    });
    expect(storedText(rendered)).toBe(addedBirds);

    await act(async () => {
      await rendered.canvas.session.undo();
      await settle();
    });
    expect(storedText(rendered)).toBe(PIE);
    await act(async () => {
      await rendered.canvas.session.redo();
      await settle();
    });
    expect(storedText(rendered)).toBe(addedBirds);

    type(textbox(GUI.newLabelField), "Fish");
    type(textbox(GUI.newValueField), "2");
    await act(async () => {
      fireEvent.click(button(GUI.addSlice));
      await settle();
    });
    expect(storedText(rendered)).toBe(`${addedBirds}  "Fish" : 2\n`);
  });

  it("is added once by save-all (Ctrl/Cmd+S)", async () => {
    const rendered = await openGui();
    type(textbox(GUI.newLabelField), "Birds");
    type(textbox(GUI.newValueField), "7");
    expect((await saveAll(rendered)).ok).toBe(true);
    expect((await saveAll(rendered)).ok).toBe(true);
    expect(storedText(rendered)).toBe(addedBirds);
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("is added by 保存 in the unsaved-close dialog", async () => {
    const rendered = await openGui(PIE, createFakeRenderer(), {
      autoSave: false,
    });
    type(textbox(GUI.newLabelField), "Birds");
    type(textbox(GUI.newValueField), "7");
    const path = rendered.canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    await act(async () => {
      await rendered.shell.actions.closeDocument(DOCUMENT_A);
      await rendered.shell.actions.answerUnsavedClose("save");
      await settle();
    });
    expect(rendered.shell.gateway.files.get(path)).toBe(addedBirds);
  });

  it("is dropped by 保存せずに閉じる and nothing is added later", async () => {
    const rendered = await openGui(PIE, createFakeRenderer(), {
      autoSave: false,
    });
    type(textbox(GUI.newLabelField), "Birds");
    type(textbox(GUI.newValueField), "7");
    const path = rendered.canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    rendered.shell.gateway.clearCalls();
    const attempts = watchOperations(rendered);
    await act(async () => {
      await rendered.shell.actions.closeDocument(DOCUMENT_A);
      await rendered.shell.actions.answerUnsavedClose("discard");
      await settle();
    });
    expect(attempts).not.toHaveBeenCalled();
    expect(rendered.shell.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(rendered.shell.gateway.files.get(path)).toBe(PIE);
    expect(operationErrorsOf(rendered)).toEqual([]);
  });

  it("refuses the switch to Source while it has input, and keeps the input", async () => {
    const rendered = await openGui();
    const attempts = watchOperations(rendered);
    type(textbox(GUI.newLabelField), "Birds");
    type(textbox(GUI.newValueField), "7");
    fireEvent.click(button(GUI.modeSource));
    await act(settle);

    expect(button(GUI.modeGui).getAttribute("aria-pressed")).toBe("true");
    expect(alertText()).toContain(GUI.addInputPending);
    expect(textbox(GUI.newLabelField).value).toBe("Birds");
    expect(textbox(GUI.newValueField).value).toBe("7");
    expect(attempts).not.toHaveBeenCalled();
    expect(storedText(rendered)).toBe(PIE);
    expect(await rendered.canvas.undoDepth()).toBe(0);
  });

  it("switches to Source once the add form is empty again", async () => {
    await openGui();
    type(textbox(GUI.newLabelField), "Birds");
    fireEvent.click(button(GUI.modeSource));
    await act(settle);
    type(textbox(GUI.newLabelField), "");
    fireEvent.click(button(GUI.modeSource));
    await act(settle);
    expect(button(GUI.modeSource).getAttribute("aria-pressed")).toBe("true");
  });

  it("is not added when the editor goes away; the values are in one notification", async () => {
    const rendered = await openGui();
    const attempts = watchOperations(rendered);
    type(textbox(GUI.newLabelField), "Birds");
    type(textbox(GUI.newValueField), "7");

    await leaveEditorWithoutBlur(rendered);

    expect(attempts).not.toHaveBeenCalled();
    expect(storedText(rendered)).toBe(PIE);
    const [only, ...rest] = operationErrorsOf(rendered);
    expect(rest).toEqual([]);
    expect(only?.operation).toBe("editDiagram");
    expect(only?.error.detail).toContain(GUI.unappliedHeading);
    expect(only?.error.detail).toContain(`${GUI.newLabelField}: Birds`);
    expect(only?.error.detail).toContain(`${GUI.newValueField}: 7`);
    expect(await rendered.canvas.undoDepth()).toBe(0);
  });
});

describe("input that cannot be applied when the editor goes away", () => {
  it("is recorded with its exact value and is not applied", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), INVALID_VALUE);

    await leaveEditorWithoutBlur(rendered);

    expect(storedText(rendered)).toBe(PIE);
    const [only, ...rest] = operationErrorsOf(rendered);
    expect(rest).toEqual([]);
    expect(only?.error.detail).toContain(GUI.unappliedHeading);
    expect(only?.error.detail).toContain(`${GUI.valueField}: ${INVALID_VALUE}`);
    expect(only?.error.detail).toContain(GUI.refusalReasons.negativeValue);
    expect(await rendered.canvas.undoDepth()).toBe(0);
  });

  it("is not applied anywhere later, not even in another editor of the block", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), INVALID_VALUE);
    await leaveEditorWithoutBlur(rendered);
    fireEvent.doubleClick(blockOption(0));
    await rendered.shell.user.click(button(GUI.modeGui));
    await act(settle);
    expect(textbox(GUI.titleLabel).value).toBe("Pets");
    expect(pending(rendered)).toBe(false);
    expect(storedText(rendered)).toBe(PIE);
  });

  it("moves no input to another target when undo makes the GUI uneditable", async () => {
    // Duplicate labels: Mermaid keeps only the first, so the GUI refuses to edit.
    const uneditable = `${PIE}  "Dogs" : 5\n`;
    const rendered = await openGui(uneditable);
    // Not editable yet: go to Source, make it a plain pie, come back to the GUI.
    await rendered.shell.user.click(button(GUI.switchToSource));
    const box = screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel("00000001"),
    }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: PIE } });
    await rendered.shell.user.click(button(GUI.modeGui));
    await act(settle);
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "400");
    const attempts = watchOperations(rendered);

    await act(async () => {
      await rendered.canvas.session.undo();
      await settle();
    });

    expect(storedText(rendered)).toBe(uneditable);
    expect(
      screen.queryByRole("listbox", { name: GUI.listLabel("00000001") }),
    ).toBeNull();
    const [only, ...rest] = operationErrorsOf(rendered);
    expect(rest).toEqual([]);
    expect(only?.error.detail).toContain(`${GUI.valueField}: 400`);
    // The only attempt was the safety net's own, and it was refused.
    expect(attempts.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("GUI -> Source shows the latest committed text", () => {
  const sourceBox = () =>
    screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel("00000001"),
    }) as HTMLTextAreaElement;

  it("after the GUI drafts were committed", async () => {
    const rendered = await openGui();
    await pick(rendered, "Dogs", "386");
    type(textbox(GUI.valueField), "400");
    type(textbox(GUI.titleLabel), "Animals");
    fireEvent.click(button(GUI.modeSource));
    await act(settle);
    expect(sourceBox().value).toBe(
      PIE.replace("386", "400").replace("Pets", "Animals"),
    );
    expect(sourceBox().value).toBe(storedText(rendered));
  });

  it("even when the store changed in the same tick, before React rendered it", async () => {
    const rendered = await openGui();
    const external = PIE.replace("Pets", "Elsewhere");
    await act(async () => {
      // One act scope: React renders only when it ends, so the editor's props still hold
      // the old text while the store has the new one.
      await rendered.canvas.canvasActions.commitContentEdit({
        documentId: DOCUMENT_A,
        sheetId: SHEET_A1,
        blockId: BLOCK_ONE,
        text: external,
      });
      fireEvent.click(button(GUI.modeSource));
      await settle();
    });
    expect(storedText(rendered)).toBe(external);
    expect(sourceBox().value).toBe(external);
  });
});

describe("GUI -> Source after a commit that finishes late", () => {
  it("shows the text that commit stored, not the one React last rendered", async () => {
    const renderer = createDeferredRenderer();
    const rendered = await openGui(PIE, renderer);
    type(textbox(GUI.titleLabel), "Animals");
    const drawsBefore = renderer.pending.length;
    await act(async () => {
      fireEvent.click(button(GUI.modeSource));
      await settle();
    });
    await waitFor(() => expect(renderer.pending.length).toBe(drawsBefore + 1));
    await act(async () => {
      renderer.pending[drawsBefore]?.resolve({ ok: true, svg: OK_SVG });
      await settle();
    });
    const box = await screen.findByRole("textbox", {
      name: MESSAGES.sourceLabel("00000001"),
    });
    expect((box as HTMLTextAreaElement).value).toBe(
      PIE.replace("Pets", "Animals"),
    );
    expect(storedText(rendered)).toBe(PIE.replace("Pets", "Animals"));
  });
});

describe("what the other triggers do with the title and the slice editor", () => {
  it("saves a pending title with save-all and reports a refused one as a failure", async () => {
    const rendered = await openGui();
    type(textbox(GUI.titleLabel), "Animals");
    expect((await saveAll(rendered)).ok).toBe(true);
    expect(storedText(rendered)).toBe(PIE.replace("Pets", "Animals"));

    type(textbox(GUI.titleLabel), " x  y");
    expect((await saveAll(rendered)).ok).toBe(false);
    expect(textbox(GUI.titleLabel).value).toBe(" x  y");
  });
});
