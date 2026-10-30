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
} from "../../application/test-support/workspace-harness";
import { BLOCK_ONE } from "../canvas/test-support/canvas-harness";
import {
  blockOption,
  canvasElement,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import {
  type ActionsHarness,
  seedSheetBlocks,
} from "../workspace/test-support/actions-harness";
import { MERMAID_MESSAGES } from "./mermaid-messages";
import type { MermaidRenderer } from "./mermaid-renderer-types";
import {
  createDeferredRenderer,
  createFakeRenderer,
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
const GUI = MESSAGES.gui;
const SHORT_ID = "00000001";
const PIE = [
  "pie title Pets",
  '  "Dogs" : 386',
  '  "Cats" : 85',
  '  "Rats" : 15',
  "",
].join("\n");
const SELECTED_ATTRIBUTE = "aria-selected";

function seedMermaid(source: string) {
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

async function openGui(
  source: string = PIE,
  renderer: MermaidRenderer = createFakeRenderer(),
) {
  const rendered = await renderOpenedCanvas(seedMermaid(source), {
    mermaidRenderer: renderer,
  });
  fireEvent.doubleClick(blockOption(0));
  await rendered.shell.user.click(
    screen.getByRole("button", { name: GUI.modeGui }),
  );
  await act(settle);
  return rendered;
}
type Rendered = Awaited<ReturnType<typeof openGui>>;

const storedText = (rendered: Rendered): string | undefined =>
  rendered.canvas.session.getState().contents.get(BLOCK_ONE);
const list = () =>
  screen.getByRole("listbox", { name: GUI.listLabel(SHORT_ID) });
const optionNames = () =>
  within(list())
    .getAllByRole("option")
    .map((option) => option.getAttribute("aria-label"));
const option = (label: string, value: string) =>
  within(list()).getByRole("option", { name: GUI.sliceOption(label, value) });
const textbox = (name: string) =>
  screen.getByRole("textbox", { name }) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name });
const alertText = () => screen.queryByRole("alert")?.textContent ?? null;

async function select(rendered: Rendered, label: string, value: string) {
  await rendered.shell.user.click(option(label, value));
}

async function enterValue(
  rendered: Rendered,
  field: HTMLInputElement,
  text: string,
  key = "{Enter}",
) {
  await rendered.shell.user.clear(field);
  await rendered.shell.user.type(field, `${text}${key}`);
  await act(settle);
}

describe("the mode switch", () => {
  it("opens in Source and shows the GUI only after the GUI button is used", async () => {
    const rendered = await renderOpenedCanvas(seedMermaid(PIE), {
      mermaidRenderer: createFakeRenderer(),
    });
    fireEvent.doubleClick(blockOption(0));
    expect(
      screen.getByRole("textbox", { name: MESSAGES.sourceLabel(SHORT_ID) }),
    ).toBeTruthy();
    expect(button(GUI.modeSource).getAttribute("aria-pressed")).toBe("true");
    expect(button(GUI.modeGui).getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.queryByRole("listbox", { name: GUI.listLabel(SHORT_ID) }),
    ).toBeNull();

    await rendered.shell.user.click(button(GUI.modeGui));
    expect(button(GUI.modeGui).getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.queryByRole("textbox", { name: MESSAGES.sourceLabel(SHORT_ID) }),
    ).toBeNull();
    expect(optionNames()).toEqual([
      GUI.sliceOption("Dogs", "386"),
      GUI.sliceOption("Cats", "85"),
      GUI.sliceOption("Rats", "15"),
    ]);
  });

  it("commits the Source draft first (one history entry) and then shows it in the GUI", async () => {
    const rendered = await renderOpenedCanvas(seedMermaid(PIE), {
      mermaidRenderer: createFakeRenderer(),
    });
    fireEvent.doubleClick(blockOption(0));
    const box = screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel(SHORT_ID),
    });
    await rendered.shell.user.clear(box);
    await rendered.shell.user.click(box);
    await rendered.shell.user.paste('pie\n  "Birds" : 7');
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);

    await rendered.shell.user.click(button(GUI.modeGui));
    await act(settle);

    expect(storedText(rendered)).toBe('pie\n  "Birds" : 7');
    expect(await rendered.canvas.undoDepth()).toBe(1);
    expect(optionNames()).toEqual([GUI.sliceOption("Birds", "7")]);
  });

  it("shows the committed text again when going back to Source, edits of the GUI included", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    await enterValue(rendered, textbox(GUI.valueField), "400");
    await rendered.shell.user.click(button(GUI.modeSource));

    const box = screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel(SHORT_ID),
    }) as HTMLTextAreaElement;
    expect(box.value).toBe(PIE.replace("386", "400"));
    expect(document.activeElement).toBe(box);
  });

  it("does not commit a stale draft over the GUI's edits when the editor is left", async () => {
    const rendered = await renderOpenedCanvas(seedMermaid(PIE), {
      mermaidRenderer: createFakeRenderer(),
    });
    fireEvent.doubleClick(blockOption(0));
    const box = screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel(SHORT_ID),
    });
    await rendered.shell.user.clear(box);
    await rendered.shell.user.click(box);
    await rendered.shell.user.paste('pie\n  "A" : 1\n  "B" : 2');
    await rendered.shell.user.click(button(GUI.modeGui));
    await select(rendered, "A", "1");
    await enterValue(rendered, textbox(GUI.valueField), "5");

    await rendered.shell.user.click(canvasElement());
    await act(settle);

    expect(storedText(rendered)).toBe('pie\n  "A" : 5\n  "B" : 2');
    expect(await rendered.canvas.undoDepth()).toBe(2);
    expect(rendered.shell.uiStateStore.getState().editingBlock).toBeNull();
  });
});

describe("a pie chart in the GUI", () => {
  it("shows the title and the slices with their values", async () => {
    await openGui();
    expect(textbox(GUI.titleLabel).value).toBe("Pets");
    expect(optionNames()).toEqual([
      GUI.sliceOption("Dogs", "386"),
      GUI.sliceOption("Cats", "85"),
      GUI.sliceOption("Rats", "15"),
    ]);
    expect(screen.getByText(GUI.noSelection)).toBeTruthy();
    // The same preview component draws it as an image.
    expect(
      within(
        screen.getByRole("region", { name: MESSAGES.previewLabel(SHORT_ID) }),
      ).getByRole("img"),
    ).toBeTruthy();
  });

  it("selects a slice by click and shows it in the editor", async () => {
    const rendered = await openGui();
    await select(rendered, "Cats", "85");
    expect(option("Cats", "85").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    expect(option("Dogs", "386").getAttribute(SELECTED_ATTRIBUTE)).toBe(
      "false",
    );
    expect(textbox(GUI.labelField).value).toBe("Cats");
    expect(textbox(GUI.valueField).value).toBe("85");
    expect(document.activeElement).toBe(list());
    // Selecting changes nothing in the document.
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
  });

  it("selects with the arrow keys, Home and End, and Enter moves to the editor", async () => {
    const rendered = await openGui();
    list().focus();
    await rendered.shell.user.keyboard("{ArrowDown}");
    expect(option("Dogs", "386").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    await rendered.shell.user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(option("Rats", "15").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    await rendered.shell.user.keyboard("{ArrowUp}");
    expect(option("Cats", "85").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    await rendered.shell.user.keyboard("{Home}");
    expect(option("Dogs", "386").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    await rendered.shell.user.keyboard("{End}");
    expect(option("Rats", "15").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    expect(list().getAttribute("aria-activedescendant")).toBe(
      option("Rats", "15").id,
    );

    await rendered.shell.user.keyboard("{Enter}");
    expect(document.activeElement).toBe(textbox(GUI.labelField));
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
  });

  it("renames a slice with Enter: one history entry, the text and the preview follow", async () => {
    const renderer = createFakeRenderer();
    const rendered = await openGui(PIE, renderer);
    await select(rendered, "Cats", "85");
    await enterValue(rendered, textbox(GUI.labelField), "Kittens");

    expect(storedText(rendered)).toBe(PIE.replace("Cats", "Kittens"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
    expect(optionNames()).toEqual([
      GUI.sliceOption("Dogs", "386"),
      GUI.sliceOption("Kittens", "85"),
      GUI.sliceOption("Rats", "15"),
    ]);
    expect(option("Kittens", "85").getAttribute(SELECTED_ATTRIBUTE)).toBe(
      "true",
    );
    await waitFor(() =>
      expect(renderer.calls.at(-1)?.source).toBe(
        PIE.replace("Cats", "Kittens"),
      ),
    );
    expect(alertText()).toBeNull();
  });

  it("changes a value with the Apply button and with leaving the field", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    await rendered.shell.user.clear(textbox(GUI.valueField));
    await rendered.shell.user.type(textbox(GUI.valueField), "400");
    await rendered.shell.user.click(button(GUI.apply));
    await act(settle);
    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));

    await rendered.shell.user.clear(textbox(GUI.valueField));
    await rendered.shell.user.type(textbox(GUI.valueField), "1.5");
    await rendered.shell.user.tab();
    await act(settle);
    expect(storedText(rendered)).toBe(PIE.replace("386", "1.5"));
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("applies a changed label and value as two operations (two undo steps)", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    await rendered.shell.user.clear(textbox(GUI.labelField));
    await rendered.shell.user.type(textbox(GUI.labelField), "Wolves");
    await rendered.shell.user.clear(textbox(GUI.valueField));
    await rendered.shell.user.type(textbox(GUI.valueField), "9");
    await rendered.shell.user.click(button(GUI.apply));
    await act(settle);

    expect(storedText(rendered)).toBe(
      PIE.replace('"Dogs" : 386', '"Wolves" : 9'),
    );
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("moves a slice up and down, keeps it selected and disables the ends with a reason", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    expect(button(GUI.moveUp).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(GUI.alreadyFirst)).toBeTruthy();
    await rendered.shell.user.click(button(GUI.moveUp));
    await act(settle);
    expect(await rendered.canvas.undoDepth()).toBe(0);

    await rendered.shell.user.click(button(GUI.moveDown));
    await act(settle);
    expect(optionNames()).toEqual([
      GUI.sliceOption("Cats", "85"),
      GUI.sliceOption("Dogs", "386"),
      GUI.sliceOption("Rats", "15"),
    ]);
    expect(option("Dogs", "386").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    await rendered.shell.user.click(button(GUI.moveDown));
    await act(settle);
    expect(optionNames()).toEqual([
      GUI.sliceOption("Cats", "85"),
      GUI.sliceOption("Rats", "15"),
      GUI.sliceOption("Dogs", "386"),
    ]);
    expect(button(GUI.moveDown).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(GUI.alreadyLast)).toBeTruthy();
    expect(await rendered.canvas.undoDepth()).toBe(2);

    await rendered.shell.user.click(button(GUI.moveUp));
    await act(settle);
    expect(storedText(rendered)).toBe(
      [
        "pie title Pets",
        '  "Cats" : 85',
        '  "Dogs" : 386',
        '  "Rats" : 15',
        "",
      ].join("\n"),
    );
  });

  it("deletes a slice, selects its neighbour and keeps the focus inside the editor", async () => {
    const rendered = await openGui();
    await select(rendered, "Cats", "85");
    await rendered.shell.user.click(button(GUI.deleteSlice));
    await act(settle);

    expect(storedText(rendered)).toBe(PIE.replace('  "Cats" : 85\n', ""));
    expect(await rendered.canvas.undoDepth()).toBe(1);
    expect(optionNames()).toEqual([
      GUI.sliceOption("Dogs", "386"),
      GUI.sliceOption("Rats", "15"),
    ]);
    expect(option("Rats", "15").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    expect(rendered.shell.uiStateStore.getState().editingBlock).not.toBeNull();
    expect(
      screen
        .getByRole("group", { name: MESSAGES.editorLabel(SHORT_ID) })
        .contains(document.activeElement),
    ).toBe(true);
  });

  it("deletes the last remaining slice and shows the empty list", async () => {
    const rendered = await openGui('pie\n  "Only" : 1\n');
    await select(rendered, "Only", "1");
    await rendered.shell.user.click(button(GUI.deleteSlice));
    await act(settle);

    expect(screen.getByText(GUI.emptySlices)).toBeTruthy();
    expect(rendered.shell.uiStateStore.getState().editingBlock).not.toBeNull();
    expect(
      screen
        .getByRole("group", { name: MESSAGES.editorLabel(SHORT_ID) })
        .contains(document.activeElement),
    ).toBe(true);
  });

  it("adds a slice with Enter, selects it, clears the fields and keeps the focus", async () => {
    const rendered = await openGui();
    const label = textbox(GUI.newLabelField);
    await rendered.shell.user.type(label, "Birds");
    await rendered.shell.user.type(textbox(GUI.newValueField), "7{Enter}");
    await act(settle);

    expect(storedText(rendered)).toBe(`${PIE}  "Birds" : 7\n`);
    expect(await rendered.canvas.undoDepth()).toBe(1);
    expect(optionNames().at(-1)).toBe(GUI.sliceOption("Birds", "7"));
    expect(option("Birds", "7").getAttribute(SELECTED_ATTRIBUTE)).toBe("true");
    expect(label.value).toBe("");
    expect(textbox(GUI.newValueField).value).toBe("");
  });

  it("does not add half a slice when the focus moves from the label to the value field", async () => {
    const rendered = await openGui();
    await rendered.shell.user.type(textbox(GUI.newLabelField), "Birds");
    await rendered.shell.user.tab();
    await act(settle);
    expect(storedText(rendered)).toBe(PIE);
    expect(await rendered.canvas.undoDepth()).toBe(0);
  });

  it("sets, changes and removes the title", async () => {
    const rendered = await openGui('pie\n  "A" : 1\n');
    expect(button(GUI.titleRemove).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(GUI.noTitleToRemove)).toBeTruthy();

    await enterValue(rendered, textbox(GUI.titleLabel), "Animals");
    expect(storedText(rendered)).toBe('pie\n  title Animals\n  "A" : 1\n');
    await enterValue(rendered, textbox(GUI.titleLabel), "Zoo");
    expect(storedText(rendered)).toBe('pie\n  title Zoo\n  "A" : 1\n');
    await rendered.shell.user.click(button(GUI.titleRemove));
    await act(settle);
    expect(storedText(rendered)).toBe('pie\n  "A" : 1\n');
    expect(await rendered.canvas.undoDepth()).toBe(3);
  });

  it("removes the title when its field is emptied", async () => {
    const rendered = await openGui();
    await enterValue(rendered, textbox(GUI.titleLabel), "");
    expect(storedText(rendered)).toBe(PIE.replace("pie title Pets", "pie"));
  });

  it("re-derives its view after undo and redo, and after an edit made in Source", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    await enterValue(rendered, textbox(GUI.valueField), "400");
    expect(optionNames()[0]).toBe(GUI.sliceOption("Dogs", "400"));

    await act(async () => {
      await rendered.canvas.session.undo();
      await settle();
    });
    expect(optionNames()[0]).toBe(GUI.sliceOption("Dogs", "386"));
    expect(textbox(GUI.valueField).value).toBe("386");
    await act(async () => {
      await rendered.canvas.session.redo();
      await settle();
    });
    expect(optionNames()[0]).toBe(GUI.sliceOption("Dogs", "400"));

    await rendered.shell.user.click(button(GUI.modeSource));
    const box = screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel(SHORT_ID),
    });
    await rendered.shell.user.clear(box);
    await rendered.shell.user.click(box);
    await rendered.shell.user.paste('pie\n  "Z" : 1');
    await rendered.shell.user.click(button(GUI.modeGui));
    await act(settle);
    expect(optionNames()).toEqual([GUI.sliceOption("Z", "1")]);
  });

  it("shows an empty chart as an empty list and can add the first slice", async () => {
    const rendered = await openGui("pie\n");
    expect(screen.getByText(GUI.emptySlices)).toBeTruthy();
    expect(
      screen.queryByRole("listbox", { name: GUI.listLabel(SHORT_ID) }),
    ).toBeNull();
    await rendered.shell.user.type(textbox(GUI.newLabelField), "First");
    await rendered.shell.user.type(textbox(GUI.newValueField), "1{Enter}");
    await act(settle);
    expect(optionNames()).toEqual([GUI.sliceOption("First", "1")]);
  });

  it("shows long, Japanese and emoji labels in full (truncated by style only)", async () => {
    const long = "L".repeat(200);
    const rendered = await openGui(
      `pie\n  "${long}" : 1\n  "犬と猫" : 2\n  "🐕🐈" : 3\n`,
    );
    expect(optionNames()).toEqual([
      GUI.sliceOption(long, "1"),
      GUI.sliceOption("犬と猫", "2"),
      GUI.sliceOption("🐕🐈", "3"),
    ]);
    expect(within(option(long, "1")).getByTitle(long)).toBeTruthy();
    await select(rendered, "🐕🐈", "3");
    expect(textbox(GUI.labelField).value).toBe("🐕🐈");
  });

  it("shows a quote in a label as a quote and writes it as #quot;", async () => {
    const rendered = await openGui('pie\n  "A" : 1\n');
    await rendered.shell.user.type(textbox(GUI.newLabelField), 'say "hi"');
    await rendered.shell.user.type(textbox(GUI.newValueField), "2{Enter}");
    await act(settle);
    expect(storedText(rendered)).toContain('"say #quot;hi#quot;" : 2');
    expect(optionNames().at(-1)).toBe(GUI.sliceOption('say "hi"', "2"));
  });
});

describe("refused input", () => {
  async function expectRefused(
    rendered: Rendered,
    expectedMessage: string,
    before: string,
  ) {
    expect(alertText()).toContain(GUI.refusalHeading);
    expect(alertText()).toContain(expectedMessage);
    expect(storedText(rendered)).toBe(before);
    expect(await rendered.canvas.undoDepth()).toBe(0);
    expect(rendered.shell.uiStateStore.getState().editingBlock).not.toBeNull();
    // Refusals of the user's input are shown inline, not as notifications.
    expect(rendered.shell.uiStateStore.getState().operationErrors).toEqual([]);
  }

  it("refuses a label with a backslash and keeps what was typed", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    await enterValue(rendered, textbox(GUI.labelField), "a\\b");
    await expectRefused(rendered, GUI.refusalReasons.backslash, PIE);
    expect(textbox(GUI.labelField).value).toBe("a\\b");
  });

  it("refuses a negative value, an invalid value and a duplicate label", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    await enterValue(rendered, textbox(GUI.valueField), "-1");
    await expectRefused(rendered, GUI.refusalReasons.negativeValue, PIE);
    expect(textbox(GUI.valueField).value).toBe("-1");

    await enterValue(rendered, textbox(GUI.valueField), "1e3");
    await expectRefused(rendered, GUI.refusalReasons.invalidValue, PIE);

    await enterValue(rendered, textbox(GUI.valueField), "386");
    await enterValue(rendered, textbox(GUI.labelField), "Cats");
    await expectRefused(rendered, GUI.refusalReasons.duplicateLabel, PIE);
  });

  it("refuses entity-like and directive labels", async () => {
    const rendered = await openGui();
    const label = textbox(GUI.newLabelField);
    const cases: readonly (readonly [string, string])[] = [
      ["#35;", GUI.refusalReasons.entityLikeText],
      // "{{" types a literal brace in user-event.
      ["a%%{{b", GUI.refusalReasons.directive],
    ];
    for (const [text, message] of cases) {
      await rendered.shell.user.clear(label);
      await rendered.shell.user.type(label, text);
      await rendered.shell.user.type(textbox(GUI.newValueField), "1{Enter}");
      await act(settle);
      await expectRefused(rendered, message, PIE);
      await rendered.shell.user.clear(textbox(GUI.newValueField));
    }
    expect(label.value).toBe("a%%{b");
  });

  it("refuses an empty label before asking the application", async () => {
    const renderer = createFakeRenderer();
    const rendered = await openGui(PIE, renderer);
    const callsBefore = renderer.calls.length;
    await select(rendered, "Dogs", "386");
    await enterValue(rendered, textbox(GUI.labelField), "");
    await expectRefused(rendered, GUI.labelRequired, PIE);
    expect(renderer.calls.length).toBe(callsBefore);
  });

  it("refuses a title Mermaid would change", async () => {
    const rendered = await openGui();
    await enterValue(rendered, textbox(GUI.titleLabel), "a  b");
    await expectRefused(rendered, GUI.refusalReasons.titleNotNormalized, PIE);
  });

  it("does not change the source when Mermaid cannot draw the result", async () => {
    const renderer = createFakeRenderer((source) =>
      source.includes("Broken")
        ? { ok: false, message: "Parse error near Broken" }
        : { ok: true, svg: "<svg xmlns='http://www.w3.org/2000/svg'/>" },
    );
    const rendered = await openGui(PIE, renderer);
    await select(rendered, "Dogs", "386");
    await enterValue(rendered, textbox(GUI.labelField), "Broken");

    await expectRefused(rendered, GUI.refusalKinds.diagramRenderRejected, PIE);
    expect(screen.getByText("Parse error near Broken").tagName).toBe("PRE");
    expect(textbox(GUI.labelField).value).toBe("Broken");
  });

  it("does nothing for an unchanged value: no command, no render, no history", async () => {
    const renderer = createFakeRenderer();
    const rendered = await openGui(PIE, renderer);
    await select(rendered, "Dogs", "386");
    const callsBefore = renderer.calls.length;
    const field = textbox(GUI.valueField);
    await rendered.shell.user.click(field);
    await rendered.shell.user.keyboard("{Enter}");
    await rendered.shell.user.click(button(GUI.apply));
    await rendered.shell.user.tab();
    await act(settle);
    expect(renderer.calls.length).toBe(callsBefore);
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
    expect(alertText()).toBeNull();
  });

  it("clears the message when another slice is selected after the refused input was reverted", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    await enterValue(rendered, textbox(GUI.valueField), "-1");
    expect(alertText()).not.toBeNull();
    // The refused text is still a pending edit, so choosing another slice would commit it
    // first (and fail): the selection stays until the input is reverted.
    await rendered.shell.user.click(button(GUI.revert));
    await select(rendered, "Cats", "85");
    expect(alertText()).toBeNull();
  });
});

describe("while an operation is in flight", () => {
  it("blocks further input, shows the busy state and applies exactly once", async () => {
    const renderer = createDeferredRenderer();
    const rendered = await openGui(PIE, renderer);
    await select(rendered, "Dogs", "386");
    const pendingBefore = renderer.pending.length;

    await rendered.shell.user.clear(textbox(GUI.valueField));
    await rendered.shell.user.type(textbox(GUI.valueField), "400{Enter}");
    await waitFor(() =>
      expect(renderer.pending.length).toBe(pendingBefore + 1),
    );
    expect(screen.getByText(GUI.busy)).toBeTruthy();
    expect(button(GUI.apply).getAttribute("aria-disabled")).toBe("true");
    expect(button(GUI.deleteSlice).getAttribute("aria-disabled")).toBe("true");
    expect(textbox(GUI.valueField).getAttribute("aria-busy")).toBe("true");

    // A second submit while busy is ignored (no second render check).
    await rendered.shell.user.click(button(GUI.apply));
    await rendered.shell.user.click(button(GUI.deleteSlice));
    expect(renderer.pending.length).toBe(pendingBefore + 1);

    await act(async () => {
      renderer.pending.at(-1)?.resolve({
        ok: true,
        svg: "<svg xmlns='http://www.w3.org/2000/svg'/>",
      });
      await settle();
    });
    await waitFor(() => expect(screen.queryByText(GUI.busy)).toBeNull());
    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
    expect(button(GUI.apply).getAttribute("aria-disabled")).toBe("false");
  });

  it("applies nothing when the text changed while Mermaid was drawing, and re-derives the view", async () => {
    const renderer = createDeferredRenderer();
    const rendered = await openGui(PIE, renderer);
    await select(rendered, "Dogs", "386");
    const pendingBefore = renderer.pending.length;
    await rendered.shell.user.clear(textbox(GUI.valueField));
    await rendered.shell.user.type(textbox(GUI.valueField), "400{Enter}");
    await waitFor(() =>
      expect(renderer.pending.length).toBe(pendingBefore + 1),
    );

    const external = PIE.replace('"Dogs" : 386', '"Dogs" : 1');
    await act(async () => {
      await rendered.canvas.canvasActions.commitContentEdit({
        documentId: DOCUMENT_A,
        sheetId: SHEET_A1,
        blockId: BLOCK_ONE,
        text: external,
      });
      await settle();
    });
    await act(async () => {
      renderer.pending[pendingBefore]?.resolve({
        ok: true,
        svg: "<svg xmlns='http://www.w3.org/2000/svg'/>",
      });
      await settle();
    });

    await waitFor(() =>
      expect(alertText()).toContain(GUI.refusalKinds.staleContent),
    );
    expect(storedText(rendered)).toBe(external);
    expect(optionNames()[0]).toBe(GUI.sliceOption("Dogs", "1"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });
});

describe("a source the GUI cannot edit", () => {
  async function expectNotEditable(rendered: Rendered, reason: string) {
    expect(screen.getByText(GUI.notEditableTitle)).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
    expect(
      screen.queryByRole("listbox", { name: GUI.listLabel(SHORT_ID) }),
    ).toBeNull();
    expect(screen.queryByRole("textbox", { name: GUI.titleLabel })).toBeNull();
    expect(storedText(rendered)).toBeDefined();
  }

  it.each([
    ["duplicate labels", 'pie\n  "A" : 1\n  "A" : 2\n', "duplicateLabels"],
    ["an unknown line", 'pie\n  "A" : 1\n  what is this\n', "unsupportedLines"],
    ["an inline directive", 'pie\n  "A%%{x}%%" : 1\n', "inlineDirective"],
    [
      "another diagram type",
      "timeline\n  title History\n  2024 : launch\n",
      "noEditorForType",
    ],
    ["an empty source", "", "empty"],
    ["an unknown type", "nonsense\n", "unknownType"],
  ] as const)("explains %s and offers Source", async (_name, source, code) => {
    const rendered = await openGui(source);
    await expectNotEditable(rendered, GUI.notEditableReasons[code]);

    await rendered.shell.user.click(button(GUI.switchToSource));
    const box = screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel(SHORT_ID),
    }) as HTMLTextAreaElement;
    expect(box.value).toBe(source);
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
  });

  it("disables the GUI after a Source edit makes the chart non-editable, and enables it again", async () => {
    const rendered = await openGui();
    await rendered.shell.user.click(button(GUI.modeSource));
    const box = screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel(SHORT_ID),
    });
    await rendered.shell.user.clear(box);
    await rendered.shell.user.click(box);
    await rendered.shell.user.paste('pie\n  "A" : 1\n  "A" : 2');
    await rendered.shell.user.click(button(GUI.modeGui));
    await act(settle);
    expect(
      screen.getByText(GUI.notEditableReasons.duplicateLabels),
    ).toBeTruthy();

    await act(async () => {
      await rendered.canvas.session.undo();
      await settle();
    });
    expect(optionNames()).toEqual([
      GUI.sliceOption("Dogs", "386"),
      GUI.sliceOption("Cats", "85"),
      GUI.sliceOption("Rats", "15"),
    ]);
  });
});

describe("the canvas leaves the GUI alone", () => {
  it("does not delete, move, select, pan or zoom for keys, pointer and wheel inside the GUI", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    const { shell } = rendered;
    const selectionBefore = shell.uiStateStore.getState().selectionBySheet;
    const viewportBefore = shell.uiStateStore.getState().viewportBySheet;
    const controls: readonly HTMLElement[] = [
      list(),
      textbox(GUI.labelField),
      textbox(GUI.titleLabel),
      button(GUI.moveDown),
      option("Dogs", "386"),
    ];

    for (const control of controls) {
      for (const key of ["Delete", "Backspace", "ArrowLeft", "ArrowRight"]) {
        expect(fireEvent.keyDown(control, { key })).toBe(true);
      }
      fireEvent.pointerDown(control, {
        clientX: 50,
        clientY: 50,
        button: 0,
        pointerId: 1,
      });
      expect(fireEvent.wheel(control, { deltaY: 120 })).toBe(true);
    }
    // Arrow keys and Enter in the list belong to the list; Enter in a field to the field.
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "Enter" });
    fireEvent.keyDown(textbox(GUI.valueField), { key: "Enter" });
    await act(settle);

    expect(shell.uiStateStore.getState().interaction.kind).toBe("idle");
    expect(shell.uiStateStore.getState().selectionBySheet).toBe(
      selectionBefore,
    );
    expect(shell.uiStateStore.getState().viewportBySheet).toBe(viewportBefore);
    expect(rendered.canvas.blocksOfSheetA1()).toHaveLength(3);
    expect(rendered.canvas.blocksOfSheetA1()[0]?.position).toEqual({
      x: 10,
      y: 20,
    });
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
    expect(shell.uiStateStore.getState().editingBlock).not.toBeNull();
  });

  it("keeps Ctrl+Z for the field instead of the application history", async () => {
    const rendered = await openGui();
    await select(rendered, "Dogs", "386");
    await enterValue(rendered, textbox(GUI.valueField), "400");
    expect(
      fireEvent.keyDown(textbox(GUI.valueField), { key: "z", ctrlKey: true }),
    ).toBe(true);
    await act(settle);
    expect(storedText(rendered)).toBe(PIE.replace("386", "400"));
  });
});

describe("theme", () => {
  it("draws the preview again with the new theme while the GUI is shown", async () => {
    const renderer = createFakeRenderer();
    const rendered = await openGui(PIE, renderer);
    await waitFor(() => expect(renderer.calls.length).toBeGreaterThan(0));
    const before = renderer.calls.length;
    await act(async () => {
      const controller = rendered.shell.services.themeController;
      controller.applyExternal(
        controller.store.getState().resolvedTheme === "dark" ? "light" : "dark",
      );
      await settle();
    });
    await waitFor(() => expect(renderer.calls.length).toBeGreaterThan(before));
  });
});

describe("failures that are not the user's input", () => {
  it("records a closed document like every other action's failure", async () => {
    const rendered = await openGui();
    const missing = "01928f3a-8e9f-7a01-8234-0000000000ff" as typeof DOCUMENT_A;
    const result = await rendered.canvas.canvasActions.applyDiagramOperation({
      documentId: missing,
      sheetId: SHEET_A1,
      blockId: BLOCK_ONE,
      operation: { diagram: "pie", operation: { kind: "removeTitle" } },
      renderCheck: async () => ({ ok: true }),
    });
    expect(result.ok).toBe(false);
    expect(
      rendered.shell.uiStateStore
        .getState()
        .operationErrors.map((entry) => entry.operation),
    ).toEqual(["editDiagram"]);
  });

  it("returns a refusal without recording it", async () => {
    const rendered = await openGui();
    const result = await rendered.canvas.canvasActions.applyDiagramOperation({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockId: BLOCK_ONE,
      operation: {
        diagram: "pie",
        operation: { kind: "setTitle", title: "a  b" },
      },
      renderCheck: async () => ({ ok: true }),
    });
    expect(result.ok).toBe(false);
    expect(rendered.shell.uiStateStore.getState().operationErrors).toEqual([]);
  });
});
