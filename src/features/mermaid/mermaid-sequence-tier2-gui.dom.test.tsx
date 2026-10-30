// @vitest-environment jsdom
// The Tier 2 controls of the sequence GUI (docs/architecture.md §16.16.9): moving and deleting
// participants, wrapping and unwrapping blocks, adding and deleting branches, the activation
// choice and duplicating a message. Each goes through the Application gate (one undo each).
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
  "  A->>B: Bye",
  "",
].join("\n");
const WITH_NOTE = [
  "sequenceDiagram",
  "  participant A as Alice",
  "  participant B as Bob",
  "  A->>B: Hello",
  "  Note over A,B: both",
  "",
].join("\n");
const WITH_BLOCKS = [
  "sequenceDiagram",
  "  participant U as User",
  "  participant S as Server",
  "  U->>S: req",
  "  alt ok",
  "    S-->>U: 200",
  "  else fail",
  "    S-->>U: 500",
  "  end",
  "  loop retry",
  "    U->>S: again",
  "  end",
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

const message = (from: string, to: string, arrow: string, text: string) =>
  TEXT.messageOption(from, to, arrow, text, "");
const participantName = (label: string, id: string) =>
  TEXT.participantOption(label, id, TEXT.kinds.participant);

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
async function choose(rendered: Rendered, select: HTMLElement, value: string) {
  await rendered.shell.user.selectOptions(select, value);
  await act(settle);
}
async function press(rendered: Rendered, name: string) {
  await rendered.shell.user.click(button(name));
  await act(settle);
}
async function undo(rendered: Rendered) {
  await act(async () => {
    await rendered.canvas.session.undo();
    await settle();
  });
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

describe("participants", () => {
  it("moves a participant a column and keeps it selected; one undo restores", async () => {
    const rendered = await openGui();
    await pickParticipant(rendered, participantName("Alice", "A"));
    expect(isDisabled(button(TEXT.moveLeft))).toBe(true);
    expect(screen.getByText(GUI.refusalReasons.atBoundary)).toBeTruthy();
    await press(rendered, TEXT.moveRight);
    expect(storedText(rendered)).toBe(
      SEQUENCE.replace(
        "  participant A as Alice\n  participant B as Bob\n",
        "  participant B as Bob\n  participant A as Alice\n",
      ),
    );
    expect(optionNames(participantList())).toEqual([
      participantName("Bob", "B"),
      participantName("Alice", "A"),
    ]);
    expect(textbox(TEXT.participantLabelField).value).toBe("Alice");
    expect(isDisabled(button(TEXT.moveRight))).toBe(true);
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await undo(rendered);
    expect(storedText(rendered)).toBe(SEQUENCE);
  });

  it("deletes a participant with its messages, and one undo restores everything", async () => {
    const rendered = await openGui();
    await pickParticipant(rendered, participantName("Bob", "B"));
    await press(rendered, TEXT.deleteParticipant);
    expect(storedText(rendered)).toBe(
      "sequenceDiagram\n  participant A as Alice\n",
    );
    expect(screen.queryByText(TEXT.selectedParticipantHeading)).toBeNull();
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await undo(rendered);
    expect(storedText(rendered)).toBe(SEQUENCE);
  });

  it("does not offer to delete a participant that a note shares with another", async () => {
    const rendered = await openGui(WITH_NOTE);
    await pickParticipant(rendered, participantName("Bob", "B"));
    expect(isDisabled(button(TEXT.deleteParticipant))).toBe(true);
    expect(
      screen.getByText(GUI.refusalReasons.noteSpansParticipants),
    ).toBeTruthy();
    await rendered.shell.user.click(button(TEXT.deleteParticipant));
    await act(settle);
    expect(storedText(rendered)).toBe(WITH_NOTE);
  });
});

describe("blocks", () => {
  it("wraps the selected message in a block kind and text of the user's choice", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Bob", "Alice", "-->>", "Hi"));
    await choose(rendered, combobox(TEXT.wrapBlockField), "opt");
    await rendered.shell.user.type(
      textbox(TEXT.blockToolsText),
      "maybe; really",
    );
    await press(rendered, TEXT.wrapInBlock);
    expect(storedText(rendered)).toBe(
      SEQUENCE.replace(
        "  B-->>A: Hi\n",
        "  opt maybe#59; really\n    B-->>A: Hi\n  end\n",
      ),
    );
    expect(textbox(TEXT.blockToolsText).value).toBe("");
    // The selection follows the message into the block.
    expect(textbox(TEXT.messageTextField).value).toBe("Hi");
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await undo(rendered);
    expect(storedText(rendered)).toBe(SEQUENCE);
  });

  it("wraps a range up to a later entry", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Alice", "Bob", "->>", "Hello"));
    const through = within(combobox(TEXT.wrapThroughField)).getByRole(
      "option",
      { name: message("Alice", "Bob", "->>", "Bye") },
    ) as HTMLOptionElement;
    await choose(rendered, combobox(TEXT.wrapThroughField), through.value);
    await press(rendered, TEXT.wrapInBlock);
    expect(storedText(rendered)).toBe(
      SEQUENCE.replace(
        "  A->>B: Hello\n  B-->>A: Hi\n  A->>B: Bye\n",
        "  loop\n    A->>B: Hello\n    B-->>A: Hi\n    A->>B: Bye\n  end\n",
      ),
    );
  });

  it("unwraps a block and keeps its content; a block with branches says why not", async () => {
    const rendered = await openGui(WITH_BLOCKS);
    await pickEntry(rendered, TEXT.blockOption("alt", "ok"));
    expect(isDisabled(button(TEXT.unwrapBlock))).toBe(true);
    expect(screen.getByText(GUI.refusalReasons.hasBranches)).toBeTruthy();
    await pickEntry(rendered, TEXT.blockOption("loop", "retry"));
    await press(rendered, TEXT.unwrapBlock);
    expect(storedText(rendered)).toBe(
      WITH_BLOCKS.replace(
        "  loop retry\n    U->>S: again\n  end\n",
        "  U->>S: again\n",
      ),
    );
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await undo(rendered);
    expect(storedText(rendered)).toBe(WITH_BLOCKS);
  });

  it("adds a branch with its text, and deletes it with its content", async () => {
    const rendered = await openGui(WITH_BLOCKS);
    await pickEntry(rendered, TEXT.blockOption("alt", "ok"));
    await rendered.shell.user.type(textbox(TEXT.blockToolsText), "third");
    await press(rendered, TEXT.addBranch);
    expect(storedText(rendered)).toBe(
      WITH_BLOCKS.replace(
        "    S-->>U: 500\n  end\n",
        "    S-->>U: 500\n  else third\n  end\n",
      ),
    );
    await pickEntry(rendered, TEXT.branchOption("else", "fail"));
    await press(rendered, TEXT.deleteBranch);
    expect(storedText(rendered)).toBe(
      WITH_BLOCKS.replace(
        "    S-->>U: 500\n  end\n",
        "  else third\n  end\n",
      ).replace("  else fail\n", ""),
    );
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("does not offer a branch for a loop", async () => {
    const rendered = await openGui(WITH_BLOCKS);
    await pickEntry(rendered, TEXT.blockOption("loop", "retry"));
    expect(screen.queryByRole("button", { name: TEXT.addBranch })).toBeNull();
  });
});

describe("messages", () => {
  it("activates the receiver, closes the activation with the reply, and undoes both", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Alice", "Bob", "->>", "Hello"));
    await choose(rendered, combobox(TEXT.activationField), "+");
    expect(storedText(rendered)).toContain("A->>+B: Hello\n");
    await pickEntry(rendered, `${message("Bob", "Alice", "-->>", "Hi")}`);
    await choose(rendered, combobox(TEXT.activationField), "-");
    expect(storedText(rendered)).toContain("B-->>-A: Hi\n");
    expect(await rendered.canvas.undoDepth()).toBe(2);
    await undo(rendered);
    await undo(rendered);
    expect(storedText(rendered)).toBe(SEQUENCE);
  });

  it("ignores a refused activation choice and shows the reason", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Bob", "Alice", "-->>", "Hi"));
    await choose(rendered, combobox(TEXT.activationField), "-");
    expect(storedText(rendered)).toBe(SEQUENCE);
    expect(combobox(TEXT.activationField).value).toBe("none");
    expect(
      screen.getByText(
        `${TEXT.activationChoices["-"]}: ${GUI.refusalReasons.activationPairing}`,
      ),
    ).toBeTruthy();
  });

  it("duplicates a message right behind itself", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Bob", "Alice", "-->>", "Hi"));
    await press(rendered, TEXT.duplicateMessage);
    expect(storedText(rendered)).toBe(
      SEQUENCE.replace("  B-->>A: Hi\n", "  B-->>A: Hi\n  B-->>A: Hi\n"),
    );
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });
});

describe("drafts of the block tools", () => {
  it("stays in the GUI while the block text is typed and does not apply it", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Bob", "Alice", "-->>", "Hi"));
    fireEvent.change(textbox(TEXT.blockToolsText), {
      target: { value: "half" },
    });
    await rendered.shell.user.click(button(GUI.modeSource));
    await act(settle);
    expect(alertText()).toContain(GUI.addInputPending);
    expect(storedText(rendered)).toBe(SEQUENCE);
    expect(textbox(TEXT.blockToolsText).value).toBe("half");
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(true);
  });

  it("is told to press a button when an explicit save finds block text", async () => {
    const rendered = await openGui();
    await pickEntry(rendered, message("Bob", "Alice", "-->>", "Hi"));
    fireEvent.change(textbox(TEXT.blockToolsText), {
      target: { value: "half" },
    });
    const result = await saveAll(rendered);
    expect(result.ok).toBe(false);
    expect(alertText()).toContain(TEXT.blockToolsPending);
    expect(storedText(rendered)).toBe(SEQUENCE);
  });
});
