// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationResult } from "../../application/ports/operation-error";
import { makeBlockAt, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
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
import { MERMAID_MESSAGES } from "./mermaid-messages";
import {
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
const TEXT = GUI.sequence;
const SHORT_ID = "00000001";
const SEQUENCE = [
  "sequenceDiagram",
  "  participant A as Alice",
  "  participant B as Bob",
  "  A->>B: Hello",
  "  B-->>A: Hi",
  "  Note over A,B: done",
  "",
].join("\n");
const WITH_BLOCK = [
  "sequenceDiagram",
  "  participant U as User",
  "  participant S as Server",
  "  U->>S: req",
  "  alt ok",
  "    S-->>U: 200",
  "  else fail",
  "    S-->>U: 500",
  "  end",
  "",
].join("\n");
const RESTRICTED = [
  "sequenceDiagram",
  "  A->>+B: call",
  "  B-->>-A: back",
  "  rect rgb(1,2,3)",
  "    A->>B: inside",
  "  end",
  "  C->>A: last",
  "",
].join("\n");

function seedMermaid(source: string) {
  return (harness: ActionsHarness): void => {
    const blocks = [makeBlockAt(1, 10, 20, "mermaid"), makeBlockAt(2, 300, 40)];
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
    harness.gateway.files.set(blocks[0]?.contentPath ?? "", source);
  };
}

async function openGui(source: string = SEQUENCE) {
  const rendered = await renderOpenedCanvas(seedMermaid(source), {
    mermaidRenderer: createFakeRenderer(),
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
const participantList = () =>
  screen.getByRole("listbox", { name: TEXT.participantListLabel(SHORT_ID) });
const entryList = () =>
  screen.getByRole("listbox", { name: TEXT.entryListLabel(SHORT_ID) });
const optionNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole("option")
    .map((option) => option.getAttribute("aria-label"));
const textbox = (name: string) =>
  screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
const combobox = (name: string) =>
  screen.getByRole("combobox", { name }) as HTMLSelectElement;
const button = (name: string) => screen.getByRole("button", { name });
const alertText = () => screen.queryByRole("alert")?.textContent ?? null;
const isDisabled = (element: HTMLElement) =>
  element.getAttribute("aria-disabled") === "true";

const message = (
  from: string,
  to: string,
  arrow: string,
  text: string,
  activation: "+" | "-" | "" = "",
) =>
  TEXT.messageOption(
    from,
    to,
    arrow,
    text,
    activation === "" ? "" : TEXT.activationMarks[activation],
  );
const note = (
  placement: "leftOf" | "rightOf" | "over",
  who: string,
  text: string,
) => TEXT.noteOption(TEXT.placements[placement], who, text);
const participantName = (label: string, id: string, kind = "participant") =>
  TEXT.participantOption(
    label,
    id,
    TEXT.kinds[kind as "participant" | "actor"],
  );

async function pickParticipant(rendered: Rendered, name: string) {
  await rendered.shell.user.click(
    within(participantList()).getByRole("option", { name }),
  );
}
async function pickEntry(rendered: Rendered, name: string) {
  await rendered.shell.user.click(
    within(entryList()).getByRole("option", { name }),
  );
}
async function enter(rendered: Rendered, field: HTMLElement, text: string) {
  await rendered.shell.user.clear(field);
  await rendered.shell.user.type(field, `${text}{Enter}`);
  await act(settle);
}
async function choose(rendered: Rendered, select: HTMLElement, value: string) {
  await rendered.shell.user.selectOptions(select, value);
  await act(settle);
}
const type = (field: HTMLElement, text: string): void => {
  fireEvent.change(field, { target: { value: text } });
};
async function press(rendered: Rendered, name: string) {
  await rendered.shell.user.click(button(name));
  await act(settle);
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

describe("the sequence GUI lists", () => {
  it("shows participants, messages and notes in the order of the text", async () => {
    await openGui();
    expect(optionNames(participantList())).toEqual([
      participantName("Alice", "A"),
      participantName("Bob", "B"),
    ]);
    expect(optionNames(entryList())).toEqual([
      message("Alice", "Bob", "->>", "Hello"),
      message("Bob", "Alice", "-->>", "Hi"),
      note("over", "Alice, Bob", "done"),
    ]);
    expect(combobox(TEXT.autonumberLabel).value).toBe("off");
  });

  it("shows the nesting of blocks by indentation", async () => {
    await openGui(WITH_BLOCK);
    expect(optionNames(entryList())).toEqual([
      message("User", "Server", "->>", "req"),
      TEXT.blockOption("alt", "ok"),
      message("Server", "User", "-->>", "200"),
      TEXT.branchOption("else", "fail"),
      message("Server", "User", "-->>", "500"),
      TEXT.endOption("alt"),
    ]);
    const indents = within(entryList())
      .getAllByRole("option")
      .map(
        (option) =>
          (option.firstElementChild as HTMLElement).style.paddingInlineStart,
      );
    expect(indents).toEqual([
      "calc(var(--space-3) * 0)",
      "calc(var(--space-3) * 0)",
      "calc(var(--space-3) * 1)",
      "calc(var(--space-3) * 0)",
      "calc(var(--space-3) * 1)",
      "calc(var(--space-3) * 0)",
    ]);
  });

  it("selects with the keyboard and moves to the text on Enter", async () => {
    const rendered = await openGui();
    entryList().focus();
    await rendered.shell.user.keyboard("{ArrowDown}{Enter}");
    await act(settle);
    expect(document.activeElement).toBe(textbox(TEXT.messageTextField));
    expect(textbox(TEXT.messageTextField).value).toBe("Hello");
  });
});

describe("each operation through the GUI", () => {
  it("sets and removes the title, and turns autonumber on and off", async () => {
    const rendered = await openGui();
    await enter(rendered, textbox(TEXT.titleField), "Greeting; 1");
    expect(storedText(rendered)).toBe(
      SEQUENCE.replace(
        "sequenceDiagram\n",
        "sequenceDiagram\n  title Greeting#59; 1\n",
      ),
    );
    expect(textbox(TEXT.titleField).value).toBe("Greeting; 1");
    await enter(rendered, textbox(TEXT.titleField), "");
    expect(storedText(rendered)).toBe(SEQUENCE);
    await choose(rendered, combobox(TEXT.autonumberLabel), "on");
    expect(storedText(rendered)).toContain("sequenceDiagram\n  autonumber\n");
    await choose(rendered, combobox(TEXT.autonumberLabel), "off");
    expect(storedText(rendered)).toBe(SEQUENCE);
    expect(await rendered.canvas.undoDepth()).toBe(4);
  });

  it("renames a participant on Enter and one undo restores it", async () => {
    const rendered = await openGui();
    await pickParticipant(rendered, participantName("Bob", "B"));
    await enter(rendered, textbox(TEXT.participantLabelField), "Robert");
    expect(storedText(rendered)).toBe(SEQUENCE.replace("as Bob", "as Robert"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await act(async () => {
      await rendered.canvas.session.undo();
      await settle();
    });
    expect(storedText(rendered)).toBe(SEQUENCE);
    expect(textbox(TEXT.participantLabelField).value).toBe("Bob");
  });

  it("changes a participant to an actor", async () => {
    const rendered = await openGui();
    await pickParticipant(rendered, participantName("Alice", "A"));
    await choose(rendered, combobox(TEXT.kindField), "actor");
    expect(storedText(rendered)).toBe(
      SEQUENCE.replace("participant A", "actor A"),
    );
  });

  it("adds a participant with a label, an id and a kind, and selects it", async () => {
    const rendered = await openGui();
    await rendered.shell.user.type(
      textbox(TEXT.newParticipantLabel),
      "Dan; the third",
    );
    await rendered.shell.user.type(textbox(TEXT.newParticipantId), "D");
    await choose(rendered, combobox(TEXT.newParticipantKind), "actor");
    await press(rendered, TEXT.addParticipant);
    expect(storedText(rendered)).toBe(
      SEQUENCE.replace(
        "  A->>B: Hello",
        "  actor D as Dan#59; the third\n  A->>B: Hello",
      ),
    );
    expect(textbox(TEXT.newParticipantLabel).value).toBe("");
    expect(textbox(TEXT.participantLabelField).value).toBe("Dan; the third");
  });

  it("adds a message at the end", async () => {
    const rendered = await openGui();
    await choose(rendered, combobox(TEXT.fromField), "B");
    await choose(rendered, combobox(TEXT.toField), "A");
    await choose(rendered, combobox(TEXT.newMessageArrow), "-x");
    await rendered.shell.user.type(
      textbox(TEXT.newMessageText),
      "bye{Shift>}{Enter}{/Shift}now",
    );
    await press(rendered, TEXT.addMessage);
    expect(storedText(rendered)).toBe(`${SEQUENCE}  B-xA: bye<br/>now\n`);
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("adds a message right behind the selected one", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Alice", "Bob", "->>", "Hello"));
    await choose(rendered, combobox(TEXT.fromField), "B");
    await choose(rendered, combobox(TEXT.toField), "A");
    await choose(rendered, combobox(TEXT.positionField), "after");
    await rendered.shell.user.type(textbox(TEXT.newMessageText), "ack{Enter}");
    await act(settle);
    expect(storedText(rendered)).toBe(
      SEQUENCE.replace("  A->>B: Hello\n", "  A->>B: Hello\n  B->>A: ack\n"),
    );
  });

  it("adds a note over two participants", async () => {
    const rendered = await openGui();
    await choose(rendered, combobox(TEXT.noteFirstParticipant), "A");
    await choose(rendered, combobox(TEXT.noteSecondParticipant), "B");
    await rendered.shell.user.type(textbox(TEXT.newNoteText), "hi{Enter}");
    await act(settle);
    expect(storedText(rendered)).toBe(`${SEQUENCE}  Note over A,B: hi\n`);
  });

  it("edits a message text, changes its arrow and deletes it", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Alice", "Bob", "->>", "Hello"));
    await enter(rendered, textbox(TEXT.messageTextField), "Hello #1");
    expect(storedText(rendered)).toContain("A->>B: Hello #35;1\n");
    expect(textbox(TEXT.messageTextField).value).toBe("Hello #1");
    await choose(rendered, combobox(TEXT.arrowField), "<<->>");
    expect(storedText(rendered)).toContain("A<<->>B: Hello #35;1\n");
    await press(rendered, TEXT.deleteMessage);
    expect(storedText(rendered)).toBe(SEQUENCE.replace("  A->>B: Hello\n", ""));
    expect(screen.queryByText(TEXT.selectedEntryHeading)).toBeNull();
    expect(await rendered.canvas.undoDepth()).toBe(3);
  });

  it("moves a message down and the selection follows it", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Alice", "Bob", "->>", "Hello"));
    await press(rendered, TEXT.moveDown);
    expect(storedText(rendered)).toBe(
      SEQUENCE.replace(
        "  A->>B: Hello\n  B-->>A: Hi\n",
        "  B-->>A: Hi\n  A->>B: Hello\n",
      ),
    );
    expect(textbox(TEXT.messageTextField).value).toBe("Hello");
    await press(rendered, TEXT.moveUp);
    expect(storedText(rendered)).toBe(SEQUENCE);
  });

  it("edits, re-places and deletes a note", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, note("over", "Alice, Bob", "done"));
    await enter(rendered, textbox(TEXT.noteTextField), "finished");
    expect(storedText(rendered)).toContain("Note over A,B: finished");
    await choose(rendered, combobox(TEXT.placementField), "leftOf");
    expect(storedText(rendered)).toContain("Note left of A: finished");
    await press(rendered, TEXT.deleteNote);
    expect(storedText(rendered)).not.toContain("Note");
  });

  it("edits the text of a block and of a branch", async () => {
    const rendered = await openGui(WITH_BLOCK);
    await pickEntry(rendered, TEXT.blockOption("alt", "ok"));
    await enter(rendered, textbox(TEXT.blockTextField), "fine");
    await pickEntry(rendered, TEXT.branchOption("else", "fail"));
    await enter(rendered, textbox(TEXT.blockTextField), "broken");
    expect(storedText(rendered)).toBe(
      WITH_BLOCK.replace("alt ok", "alt fine").replace(
        "else fail",
        "else broken",
      ),
    );
  });
});

describe("refusals", () => {
  it("shows the reason inline for a text with a wrap prefix and keeps the input", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Alice", "Bob", "->>", "Hello"));
    await enter(rendered, textbox(TEXT.messageTextField), "wrap: x");
    expect(alertText()).toContain(GUI.refusalReasons.wrapPrefix);
    expect(storedText(rendered)).toBe(SEQUENCE);
    expect(textbox(TEXT.messageTextField).value).toBe("wrap: x");
    expect(await rendered.canvas.undoDepth()).toBe(0);
  });

  it("refuses an empty participant label", async () => {
    const rendered = await openGui();
    await pickParticipant(rendered, participantName("Bob", "B"));
    await enter(rendered, textbox(TEXT.participantLabelField), "");
    expect(alertText()).toContain(GUI.labelRequired);
    expect(storedText(rendered)).toBe(SEQUENCE);
  });

  it("refuses an id that is already used when adding a participant", async () => {
    const rendered = await openGui();
    await rendered.shell.user.type(textbox(TEXT.newParticipantLabel), "x");
    await rendered.shell.user.type(textbox(TEXT.newParticipantId), "A{Enter}");
    await act(settle);
    expect(alertText()).toContain(GUI.refusalReasons.duplicateId);
    expect(storedText(rendered)).toBe(SEQUENCE);
    expect(textbox(TEXT.newParticipantLabel).value).toBe("x");
  });

  it("asks for both participants when adding a message", async () => {
    const rendered = await openGui();
    await choose(rendered, combobox(TEXT.fromField), "A");
    await press(rendered, TEXT.addMessage);
    expect(alertText()).toContain(TEXT.endpointsRequired);
    expect(storedText(rendered)).toBe(SEQUENCE);
  });

  it("asks for a participant when adding a note", async () => {
    const rendered = await openGui();
    await rendered.shell.user.type(textbox(TEXT.newNoteText), "x");
    await press(rendered, TEXT.addNote);
    expect(alertText()).toContain(TEXT.participantRequired);
    expect(storedText(rendered)).toBe(SEQUENCE);
  });
});

describe("a sequence diagram the GUI cannot edit, or only in part", () => {
  it("explains an unsupported statement with its line and offers Source", async () => {
    const source = "sequenceDiagram\n  A->>B: x\n  A->>()B: y\n";
    const rendered = await openGui(source);
    expect(screen.getByText(GUI.notEditableTitle)).toBeTruthy();
    expect(
      screen.getByText(GUI.notEditableReasons.unsupportedStatements),
    ).toBeTruthy();
    expect(screen.getByText(/line 3/)).toBeTruthy();
    expect(
      screen.queryByRole("listbox", {
        name: TEXT.participantListLabel(SHORT_ID),
      }),
    ).toBeNull();
    await rendered.shell.user.click(button(GUI.switchToSource));
    expect(storedText(rendered)).toBe(source);
  });

  it("explains a participant declared after it appeared", async () => {
    await openGui("sequenceDiagram\n  A->>B: x\n  participant A as Al\n");
    expect(
      screen.getByText(GUI.notEditableReasons.participantRedeclared),
    ).toBeTruthy();
  });

  it("disables delete and move of a message with an activation sign, with the reason", async () => {
    const rendered = await openGui(RESTRICTED);
    await pickEntry(rendered, message("A", "B", "->>", "call", "+"));
    expect(screen.getByText(GUI.refusalReasons.activationSign)).toBeTruthy();
    expect(isDisabled(button(TEXT.deleteMessage))).toBe(true);
    expect(isDisabled(button(TEXT.moveDown))).toBe(true);
    await rendered.shell.user.click(button(TEXT.deleteMessage));
    await act(settle);
    expect(storedText(rendered)).toBe(RESTRICTED);
    // The text and the arrow of the same message stay editable.
    await enter(rendered, textbox(TEXT.messageTextField), "ring");
    expect(storedText(rendered)).toContain("A->>+B: ring");
  });

  it("makes the text of a rect read-only and names the reason", async () => {
    const rendered = await openGui(RESTRICTED);
    await pickEntry(rendered, TEXT.blockOption("rect", "rgb(1,2,3)"));
    expect(screen.getByText(GUI.refusalReasons.colourBlock)).toBeTruthy();
    expect(textbox(TEXT.blockTextField).readOnly).toBe(true);
  });

  it("explains why a message cannot move past a block boundary", async () => {
    const rendered = await openGui(WITH_BLOCK);
    await pickEntry(rendered, message("User", "Server", "->>", "req"));
    expect(isDisabled(button(TEXT.moveDown))).toBe(true);
    expect(screen.getByText(GUI.refusalReasons.blockBoundary)).toBeTruthy();
  });

  it("does not offer to switch an autonumber with settings", async () => {
    await openGui("sequenceDiagram\n  autonumber 10\n  A->>B: x\n");
    expect(combobox(TEXT.autonumberLabel).value).toBe("custom");
    expect(isDisabled(combobox(TEXT.autonumberLabel))).toBe(true);
    expect(screen.getByText(TEXT.autonumberCustom)).toBeTruthy();
  });
});

describe("drafts", () => {
  it("keeps a typed text as a pending draft that save-all applies", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Alice", "Bob", "->>", "Hello"));
    type(textbox(TEXT.messageTextField), "Howdy");
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(true);
    expect(storedText(rendered)).toBe(SEQUENCE);

    expect((await saveAll(rendered)).ok).toBe(true);
    expect(storedText(rendered)).toBe(SEQUENCE.replace("Hello", "Howdy"));
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(
      false,
    );
  });

  it("commits a pending text when another entry is chosen", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Alice", "Bob", "->>", "Hello"));
    type(textbox(TEXT.messageTextField), "Howdy");
    await pickEntry(rendered, message("Bob", "Alice", "-->>", "Hi"));
    expect(storedText(rendered)).toContain("A->>B: Howdy");
    expect(textbox(TEXT.messageTextField).value).toBe("Hi");
  });

  it("commits a pending text when switching to Source", async () => {
    const rendered = await openGui();
    await pickParticipant(rendered, participantName("Bob", "B"));
    type(textbox(TEXT.participantLabelField), "Robert");
    await rendered.shell.user.click(button(GUI.modeSource));
    await act(settle);
    expect(storedText(rendered)).toContain("as Robert");
    expect(
      (
        screen.getByRole("textbox", {
          name: MESSAGES.sourceLabel(SHORT_ID),
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("as Robert");
  });

  it("stays in the GUI while an add form holds input, and does not add it", async () => {
    const rendered = await openGui();
    type(textbox(TEXT.newMessageText), "Half");
    await rendered.shell.user.click(button(GUI.modeSource));
    await act(settle);
    expect(alertText()).toContain(GUI.addInputPending);
    expect(storedText(rendered)).toBe(SEQUENCE);
    expect(textbox(TEXT.newMessageText).value).toBe("Half");
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(true);
  });

  it("adds a pending add form on save-all, an explicit save request", async () => {
    const rendered = await openGui();
    type(textbox(TEXT.newParticipantLabel), "Saved");
    type(textbox(TEXT.newParticipantId), "S1");
    expect((await saveAll(rendered)).ok).toBe(true);
    expect(storedText(rendered)).toContain("participant S1 as Saved\n");
  });

  it("keeps the text when the entry it belongs to changed underneath", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Bob", "Alice", "-->>", "Hi"));
    type(textbox(TEXT.messageTextField), "Howdy");
    await act(async () => {
      await rendered.canvas.canvasActions.commitContentEdit({
        documentId: DOCUMENT_A,
        sheetId: SHEET_A1,
        blockId: BLOCK_ONE,
        text: "sequenceDiagram\n  A->>B: other\n  B-->>A: new\n",
      });
      await settle();
    });
    const result = await saveAll(rendered);
    expect(result.ok).toBe(false);
    expect(textbox(TEXT.messageTextField).value).toBe("Howdy");
    expect(storedText(rendered)).not.toContain("Howdy");
  });
});
