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
const TEXT = GUI.gantt;
const SHORT_ID = "00000001";
const GANTT = [
  "gantt",
  "    title Release plan",
  "    dateFormat YYYY-MM-DD",
  "    section Design",
  "    Spec :done, des1, 2024-01-01, 3d",
  "    Review :des2, after des1, 2d",
  "    section Build",
  "    Code :b1, after des2, 5d",
  "    Test :3d",
  "    section Empty",
  "",
].join("\n");

function seedMermaid(source: string) {
  return (harness: ActionsHarness): void => {
    const blocks = [makeBlockAt(1, 10, 20, "mermaid"), makeBlockAt(2, 300, 40)];
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
    harness.gateway.files.set(blocks[0]?.contentPath ?? "", source);
  };
}

async function openGui(source: string = GANTT) {
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
const sectionList = () =>
  screen.getByRole("listbox", { name: TEXT.sectionListLabel(SHORT_ID) });
const taskList = () =>
  screen.getByRole("listbox", { name: TEXT.taskListLabel(SHORT_ID) });
const optionNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole("option")
    .map((option) => option.getAttribute("aria-label"));
const textbox = (name: string) =>
  screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
const combobox = (name: string) =>
  screen.getByRole("combobox", { name }) as HTMLSelectElement;
const checkbox = (name: string) =>
  screen.getByRole("checkbox", { name }) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name });
const alertText = () => screen.queryByRole("alert")?.textContent ?? null;
const isDisabled = (element: HTMLElement) =>
  element.getAttribute("aria-disabled") === "true";

const task = (section: string, name: string, start: string, end: string) =>
  TEXT.taskOption(section, name, start, end);
const SPEC = task("Design", "Spec", "2024-01-01", "3d");
const REVIEW = task("Design", "Review", "after des1", "2d");
const CODE = task("Build", "Code", "after des2", "5d");
const TEST = task("Build", "Test", TEXT.implicitStartShown, "3d");
const section = (name: string, count: number) =>
  TEXT.sectionOption(name, count);

async function pickSection(rendered: Rendered, name: string) {
  await rendered.shell.user.click(
    within(sectionList()).getByRole("option", { name }),
  );
}
async function pickTask(rendered: Rendered, name: string) {
  await rendered.shell.user.click(
    within(taskList()).getByRole("option", { name }),
  );
}
async function enter(rendered: Rendered, field: HTMLElement, text: string) {
  await rendered.shell.user.clear(field);
  await rendered.shell.user.type(field, `${text}{Enter}`);
  await act(settle);
}
const type = (field: HTMLElement, text: string): void => {
  fireEvent.change(field, { target: { value: text } });
};
async function press(rendered: Rendered, name: string) {
  await rendered.shell.user.click(button(name));
  await act(settle);
}
async function choose(rendered: Rendered, select: HTMLElement, value: string) {
  await rendered.shell.user.selectOptions(select, value);
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

describe("the gantt GUI lists", () => {
  it("shows the title, the date format, sections and tasks in the order of the text", async () => {
    await openGui();
    expect(textbox(TEXT.titleField).value).toBe("Release plan");
    expect(screen.getByText(TEXT.dateFormatLine("YYYY-MM-DD"))).toBeTruthy();
    expect(optionNames(sectionList())).toEqual([
      section("Design", 2),
      section("Build", 2),
      section("Empty", 0),
    ]);
    expect(optionNames(taskList())).toEqual([SPEC, REVIEW, CODE, TEST]);
  });

  it("selects with the keyboard and moves to the name on Enter", async () => {
    const rendered = await openGui();
    taskList().focus();
    await rendered.shell.user.keyboard("{ArrowDown}{Enter}");
    await act(settle);
    expect(document.activeElement).toBe(textbox(TEXT.taskNameField));
    expect(textbox(TEXT.taskNameField).value).toBe("Spec");
  });
});

describe("each operation through the GUI", () => {
  it("sets and removes the title", async () => {
    const rendered = await openGui();
    await enter(rendered, textbox(TEXT.titleField), "Plan B");
    expect(storedText(rendered)).toBe(GANTT.replace("Release plan", "Plan B"));
    await enter(rendered, textbox(TEXT.titleField), "");
    expect(storedText(rendered)).toBe(
      GANTT.replace("    title Release plan\n", ""),
    );
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("renames a section and one undo restores it", async () => {
    const rendered = await openGui();
    await pickSection(rendered, section("Build", 2));
    await enter(rendered, textbox(TEXT.sectionNameField), "Make");
    expect(storedText(rendered)).toBe(
      GANTT.replace("section Build", "section Make"),
    );
    expect(textbox(TEXT.sectionNameField).value).toBe("Make");
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await act(async () => {
      await rendered.canvas.session.undo();
      await settle();
    });
    expect(storedText(rendered)).toBe(GANTT);
    // The section was picked as "Make"; after an undo it is no longer found, which is said
    // instead of silently selecting something else.
    expect(screen.getByText(TEXT.itemGone)).toBeTruthy();
  });

  it("renames a task and the selection follows it", async () => {
    const rendered = await openGui();
    await pickTask(rendered, REVIEW);
    await enter(rendered, textbox(TEXT.taskNameField), "Peer review");
    expect(storedText(rendered)).toBe(
      GANTT.replace("Review :", "Peer review :"),
    );
    expect(textbox(TEXT.taskNameField).value).toBe("Peer review");
    // Still selected: the next change goes to the same task.
    await enter(rendered, textbox(TEXT.endField), "4d");
    expect(storedText(rendered)).toContain("Peer review :des2, after des1, 4d");
  });

  it("changes an id together with the references to it", async () => {
    const rendered = await openGui();
    await pickTask(rendered, SPEC);
    await enter(rendered, textbox(TEXT.taskIdField), "spec");
    expect(storedText(rendered)).toBe(
      GANTT.replace("des1, 2024", "spec, 2024").replace(
        "after des1",
        "after spec",
      ),
    );
    expect(textbox(TEXT.taskNameField).value).toBe("Spec");
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("changes a start between a date and a reference, and an end to a date", async () => {
    const rendered = await openGui();
    await pickTask(rendered, REVIEW);
    await enter(rendered, textbox(TEXT.startField), "2024-02-01");
    expect(storedText(rendered)).toContain("Review :des2, 2024-02-01, 2d");
    await enter(rendered, textbox(TEXT.startField), "after des1");
    expect(storedText(rendered)).toBe(GANTT);
    await enter(rendered, textbox(TEXT.endField), "2024-03-01");
    expect(storedText(rendered)).toContain("after des1, 2024-03-01");
    await enter(rendered, textbox(TEXT.endField), "until des1");
    expect(storedText(rendered)).toContain("after des1, until des1");
  });

  it("gives a task without a start one, as a date", async () => {
    const rendered = await openGui();
    await pickTask(rendered, TEST);
    expect(textbox(TEXT.startField).value).toBe("");
    await enter(rendered, textbox(TEXT.startField), "2024-05-01");
    expect(storedText(rendered)).toContain("Test :2024-05-01, 3d");
  });

  it("toggles status tags", async () => {
    const rendered = await openGui();
    await pickTask(rendered, SPEC);
    expect(checkbox(TEXT.tags.done).checked).toBe(true);
    expect(checkbox(TEXT.tags.crit).checked).toBe(false);
    await rendered.shell.user.click(checkbox(TEXT.tags.crit));
    await act(settle);
    expect(storedText(rendered)).toContain("Spec :done, crit, des1,");
    await rendered.shell.user.click(checkbox(TEXT.tags.done));
    await act(settle);
    expect(storedText(rendered)).toContain("Spec :crit, des1,");
    expect(checkbox(TEXT.tags.done).checked).toBe(false);
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("deletes a task and an empty section", async () => {
    const rendered = await openGui();
    await pickTask(rendered, TEST);
    await press(rendered, TEXT.deleteTask);
    expect(storedText(rendered)).toBe(GANTT.replace("    Test :3d\n", ""));
    expect(screen.queryByText(TEXT.selectedTaskHeading)).toBeNull();
    await pickSection(rendered, section("Empty", 0));
    await press(rendered, TEXT.deleteSection);
    expect(storedText(rendered)).toBe(
      GANTT.replace("    Test :3d\n", "").replace("    section Empty\n", ""),
    );
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("adds a section at the end and behind the selected one", async () => {
    const rendered = await openGui();
    await rendered.shell.user.type(textbox(TEXT.newSectionName), "Ship{Enter}");
    await act(settle);
    expect(storedText(rendered)).toBe(`${GANTT}    section Ship\n`);
    expect(textbox(TEXT.newSectionName).value).toBe("");
    await pickSection(rendered, section("Design", 2));
    await choose(rendered, combobox(TEXT.sectionPositionField), "after");
    await rendered.shell.user.type(
      textbox(TEXT.newSectionName),
      "Review{Enter}",
    );
    await act(settle);
    expect(storedText(rendered)).toContain(
      "Review :des2, after des1, 2d\n    section Review\n    section Build",
    );
  });

  it("adds a task to a section with a generated id", async () => {
    const rendered = await openGui();
    await choose(rendered, combobox(TEXT.newTaskSection), "2");
    await rendered.shell.user.type(textbox(TEXT.newTaskName), "Deploy");
    await rendered.shell.user.type(textbox(TEXT.newTaskStart), "after b1");
    await rendered.shell.user.type(textbox(TEXT.newTaskEnd), "1d{Enter}");
    await act(settle);
    expect(storedText(rendered)).toBe(
      GANTT.replace(
        "    section Empty\n",
        "    section Empty\n    Deploy :gt1, after b1, 1d\n",
      ),
    );
    expect(textbox(TEXT.newTaskName).value).toBe("");
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("adds a task with its own id at the end of the chart", async () => {
    const rendered = await openGui();
    await rendered.shell.user.type(textbox(TEXT.newTaskName), "Wrap up");
    await rendered.shell.user.type(textbox(TEXT.newTaskId), "w1");
    await rendered.shell.user.type(textbox(TEXT.newTaskStart), "2024-06-01");
    await rendered.shell.user.type(textbox(TEXT.newTaskEnd), "2024-06-05");
    await press(rendered, TEXT.addTask);
    expect(storedText(rendered)).toBe(
      GANTT.replace(
        "    section Empty\n",
        "    section Empty\n    Wrap up :w1, 2024-06-01, 2024-06-05\n",
      ),
    );
  });
});

describe("refusals", () => {
  it("shows the reason inline for an impossible date and keeps the input", async () => {
    const rendered = await openGui();
    await pickTask(rendered, SPEC);
    await enter(rendered, textbox(TEXT.startField), "2024-02-30");
    expect(alertText()).toContain(TEXT.refusalReasons.invalidDate);
    expect(storedText(rendered)).toBe(GANTT);
    expect(textbox(TEXT.startField).value).toBe("2024-02-30");
    expect(await rendered.canvas.undoDepth()).toBe(0);
  });

  it("names a task name with a colon, and an id already used", async () => {
    const rendered = await openGui();
    await pickTask(rendered, REVIEW);
    await enter(rendered, textbox(TEXT.taskNameField), "a: b");
    expect(alertText()).toContain(TEXT.refusalReasons.colon);
    await enter(rendered, textbox(TEXT.taskIdField), "des1");
    expect(alertText()).toContain(GUI.refusalReasons.duplicateId);
    await enter(rendered, textbox(TEXT.taskIdField), "a.b");
    expect(alertText()).toContain(TEXT.refusalReasons.invalidId);
    expect(storedText(rendered)).toBe(GANTT);
  });

  it("asks for a name, a start and an end when adding a task", async () => {
    const rendered = await openGui();
    await rendered.shell.user.type(textbox(TEXT.newTaskId), "x1");
    await press(rendered, TEXT.addTask);
    expect(alertText()).toContain(TEXT.nameRequired);
    await rendered.shell.user.type(textbox(TEXT.newTaskName), "N");
    await press(rendered, TEXT.addTask);
    expect(alertText()).toContain(TEXT.startRequired);
    await rendered.shell.user.type(textbox(TEXT.newTaskStart), "2024-01-01");
    await press(rendered, TEXT.addTask);
    expect(alertText()).toContain(TEXT.endRequired);
    expect(storedText(rendered)).toBe(GANTT);
  });

  it("disables a delete with the reason, and an id that cannot be given", async () => {
    const rendered = await openGui();
    await pickTask(rendered, CODE);
    // Test starts where Code ends.
    expect(isDisabled(button(TEXT.deleteTask))).toBe(true);
    expect(screen.getByText(TEXT.refusalReasons.implicitStart)).toBeTruthy();
    await rendered.shell.user.click(button(TEXT.deleteTask));
    await act(settle);
    expect(storedText(rendered)).toBe(GANTT);
    await pickTask(rendered, TEST);
    expect(textbox(TEXT.taskIdField).readOnly).toBe(true);
    await pickSection(rendered, section("Design", 2));
    expect(isDisabled(button(TEXT.deleteSection))).toBe(true);
  });
});

describe("a gantt chart the GUI cannot edit", () => {
  it("explains an unsupported date format and offers Source", async () => {
    const source = "gantt\n    dateFormat X\n    section S\n    T :t1, 1, 1d\n";
    const rendered = await openGui(source);
    expect(screen.getByText(GUI.notEditableTitle)).toBeTruthy();
    expect(
      screen.getByText(GUI.notEditableReasons.unsupportedDateFormat),
    ).toBeTruthy();
    expect(
      screen.queryByRole("listbox", { name: TEXT.taskListLabel(SHORT_ID) }),
    ).toBeNull();
    await rendered.shell.user.click(button(GUI.switchToSource));
    expect(storedText(rendered)).toBe(source);
  });

  it("explains a line the GUI does not understand", async () => {
    await openGui(
      "gantt\n    dateFormat YYYY-MM-DD\n    topAxis\n    T :t1, 2024-01-01, 1d\n",
    );
    expect(
      screen.getByText(GUI.notEditableReasons.unsupportedLines),
    ).toBeTruthy();
  });
});

describe("drafts", () => {
  it("keeps a typed text as a pending draft that save-all applies", async () => {
    const rendered = await openGui();
    await pickTask(rendered, SPEC);
    type(textbox(TEXT.endField), "9d");
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(true);
    expect(storedText(rendered)).toBe(GANTT);
    expect((await saveAll(rendered)).ok).toBe(true);
    expect(storedText(rendered)).toBe(GANTT.replace("3d", "9d"));
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(
      false,
    );
  });

  it("commits pending name and id together when another task is chosen", async () => {
    const rendered = await openGui();
    await pickTask(rendered, SPEC);
    type(textbox(TEXT.taskIdField), "spec");
    type(textbox(TEXT.taskNameField), "Specification");
    await pickTask(rendered, REVIEW);
    expect(storedText(rendered)).toContain(
      "Specification :done, spec, 2024-01-01, 3d",
    );
    expect(storedText(rendered)).toContain("after spec");
    expect(textbox(TEXT.taskNameField).value).toBe("Review");
  });

  it("commits a pending text when switching to Source", async () => {
    const rendered = await openGui();
    await pickSection(rendered, section("Build", 2));
    type(textbox(TEXT.sectionNameField), "Make");
    await rendered.shell.user.click(button(GUI.modeSource));
    await act(settle);
    expect(storedText(rendered)).toContain("section Make");
    expect(
      (
        screen.getByRole("textbox", {
          name: MESSAGES.sourceLabel(SHORT_ID),
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("section Make");
  });

  it("stays in the GUI while an add form holds input, and does not add it", async () => {
    const rendered = await openGui();
    type(textbox(TEXT.newTaskName), "Half");
    await rendered.shell.user.click(button(GUI.modeSource));
    await act(settle);
    expect(alertText()).toContain(GUI.addInputPending);
    expect(storedText(rendered)).toBe(GANTT);
    expect(textbox(TEXT.newTaskName).value).toBe("Half");
  });

  it("keeps the text when the task it belongs to changed underneath", async () => {
    const rendered = await openGui();
    await pickTask(rendered, REVIEW);
    type(textbox(TEXT.endField), "9d");
    await act(async () => {
      await rendered.canvas.canvasActions.commitContentEdit({
        documentId: DOCUMENT_A,
        sheetId: SHEET_A1,
        blockId: BLOCK_ONE,
        text: GANTT.replace("Review", "Other"),
      });
      await settle();
    });
    const result = await saveAll(rendered);
    expect(result.ok).toBe(false);
    expect(textbox(TEXT.endField).value).toBe("9d");
    expect(storedText(rendered)).not.toContain("9d");
  });
});
