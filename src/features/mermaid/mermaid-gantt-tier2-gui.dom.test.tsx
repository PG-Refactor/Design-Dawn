// @vitest-environment jsdom
// The Tier 2 controls of the gantt GUI: chart settings,
// moving, duplicating, linking. Each control is shown or disabled from planning its
// operation, and each applied operation is one undo step.
import {
  act,
  cleanup,
  fireEvent,
  screen,
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
import { getShown } from "./test-support/reveal-in-gui";

let objectUrls: ObjectUrlFake;

beforeEach(() => {
  objectUrls = installObjectUrlFake();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  objectUrls.restore();
});

const GUI = MERMAID_MESSAGES.ja.gui;
const TEXT = GUI.gantt;
const SHORT_ID = "00000001";
const GANTT = [
  "gantt",
  "    dateFormat YYYY-MM-DD",
  "    section Design",
  "    Spec :des1, 2024-01-01, 3d",
  "    Review :des2, after des1, 2d",
  "    section Build",
  "    Code :b1, 2024-02-01, 5d",
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
  await rendered.shell.user.click(getShown("button", GUI.modeGui));
  await act(settle);
  return rendered;
}
type Rendered = Awaited<ReturnType<typeof openGui>>;

const storedText = (rendered: Rendered): string | undefined =>
  rendered.canvas.session.getState().contents.get(BLOCK_ONE);
const sectionList = () => getShown("listbox", TEXT.sectionListLabel(SHORT_ID));
const taskList = () => getShown("listbox", TEXT.taskListLabel(SHORT_ID));
const optionNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole("option")
    .map((option) => option.getAttribute("aria-label"));
const textbox = (name: string) =>
  getShown("textbox", name) as HTMLTextAreaElement;
const combobox = (name: string) =>
  getShown("combobox", name) as HTMLSelectElement;
const button = (name: string) => getShown("button", name);
const isDisabled = (element: HTMLElement) =>
  element.getAttribute("aria-disabled") === "true";

const task = (section: string, name: string, start: string, end: string) =>
  TEXT.taskOption(section, name, start, end);
const SPEC = task("Design", "Spec", "2024-01-01", "3d");
const REVIEW = task("Design", "Review", "after des1", "2d");
const CODE = task("Build", "Code", "2024-02-01", "5d");
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
  if (text !== "") await rendered.shell.user.type(field, text);
  await rendered.shell.user.type(field, "{Enter}");
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

describe("chart settings", () => {
  it("adds, changes and removes excluded days; each is one undo step", async () => {
    const rendered = await openGui();
    expect(textbox(TEXT.excludesField).value).toBe("");
    await enter(rendered, textbox(TEXT.excludesField), "weekends 2024-01-02");
    expect(storedText(rendered)).toBe(
      GANTT.replace(
        "    dateFormat YYYY-MM-DD\n",
        "    dateFormat YYYY-MM-DD\n    excludes weekends, 2024-01-02\n",
      ),
    );
    expect(textbox(TEXT.excludesField).value).toBe("weekends 2024-01-02");
    await enter(rendered, textbox(TEXT.excludesField), "monday");
    expect(storedText(rendered)).toContain("    excludes monday\n");
    await enter(rendered, textbox(TEXT.excludesField), "");
    expect(storedText(rendered)).toBe(GANTT);
    expect(await rendered.canvas.undoDepth()).toBe(3);
    await undo(rendered);
    expect(storedText(rendered)).toContain("    excludes monday\n");
  });

  it("sets the axis format and refuses a conversion d3 does not have", async () => {
    const rendered = await openGui();
    await enter(rendered, textbox(TEXT.axisFormatField), "%m/%d");
    expect(storedText(rendered)).toContain("    axisFormat %m/%d\n");
    await enter(rendered, textbox(TEXT.axisFormatField), "%E");
    expect(screen.getByRole("alert").textContent).toContain(
      TEXT.refusalReasons.unknownConversion,
    );
    expect(storedText(rendered)).toContain("    axisFormat %m/%d\n");
  });

  it("refuses excluded days it cannot place, and makes the field read-only when it cannot compute the dates", async () => {
    const rendered = await openGui();
    await enter(rendered, textbox(TEXT.excludesField), "holiday");
    expect(screen.getByRole("alert").textContent).toContain(
      TEXT.refusalReasons.unknownExcludeToken,
    );
    expect(storedText(rendered)).toBe(GANTT);
    cleanup();
    await openGui(
      GANTT.replace("3d\n    section Empty", "1M\n    section Empty"),
    );
    expect(textbox(TEXT.excludesField).readOnly).toBe(true);
    expect(screen.getByText(TEXT.refusalReasons.unknownDates)).toBeTruthy();
  });
});

describe("moving sections", () => {
  it("swaps sections with their tasks, and says when it cannot", async () => {
    const rendered = await openGui();
    await pickSection(rendered, section("Design", 2));
    expect(isDisabled(button(TEXT.moveSectionUp))).toBe(true);
    expect(
      screen.getByText(
        `${TEXT.moveSectionUp}: ${TEXT.refusalReasons.atBoundary}`,
      ),
    ).toBeTruthy();
    await press(rendered, TEXT.moveSectionDown);
    expect(storedText(rendered)).toBe(
      [
        "gantt",
        "    dateFormat YYYY-MM-DD",
        "    section Build",
        "    Code :b1, 2024-02-01, 5d",
        "    Test :3d",
        "    section Design",
        "    Spec :des1, 2024-01-01, 3d",
        "    Review :des2, after des1, 2d",
        "    section Empty",
        "",
      ].join("\n"),
    );
    // The selection follows the section to its new place.
    expect(isDisabled(button(TEXT.moveSectionDown))).toBe(false);
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await undo(rendered);
    expect(storedText(rendered)).toBe(GANTT);
  });
});

describe("moving and duplicating tasks", () => {
  it("moves a task up, fixes the start it would lose, and follows it", async () => {
    const rendered = await openGui();
    await pickTask(rendered, TEST);
    expect(
      screen.getByText(
        `${TEXT.moveTaskDown}: ${TEXT.refusalReasons.atBoundary}`,
      ),
    ).toBeTruthy();
    // Test has no id to follow, so the note names what the move writes.
    expect(
      screen.getByText(`${TEXT.moveTaskUp}: ${TEXT.freezeNote(1)}`),
    ).toBeTruthy();
    await press(rendered, TEXT.moveTaskUp);
    expect(storedText(rendered)).toBe(
      GANTT.replace(
        "    Code :b1, 2024-02-01, 5d\n    Test :3d\n",
        "    Test :2024-02-06, 3d\n    Code :b1, 2024-02-01, 5d\n",
      ),
    );
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await undo(rendered);
    expect(storedText(rendered)).toBe(GANTT);
  });

  it("keeps a moved task with an id selected", async () => {
    const rendered = await openGui();
    await pickTask(rendered, CODE);
    await press(rendered, TEXT.moveTaskDown);
    expect(optionNames(taskList())).toEqual([
      SPEC,
      REVIEW,
      task("Build", "Test", "2024-02-06", "3d"),
      CODE,
    ]);
    expect(textbox(TEXT.taskNameField).value).toBe("Code");
    expect(isDisabled(button(TEXT.moveTaskDown))).toBe(true);
    expect(isDisabled(button(TEXT.moveTaskUp))).toBe(false);
  });

  it("duplicates a task below itself with a new id", async () => {
    const rendered = await openGui();
    await pickTask(rendered, REVIEW);
    await press(rendered, TEXT.duplicateTask);
    expect(storedText(rendered)).toContain(
      "    Review :des2, after des1, 2d\n    Review :gt1, after des1, 2d\n",
    );
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("says why a task cannot be duplicated", async () => {
    await openGui(
      GANTT.replace("    Test :3d\n", "    Test :3d\n    Rest :1d\n"),
    ).then(async (rendered) => {
      await pickTask(rendered, TEST);
      expect(isDisabled(button(TEXT.duplicateTask))).toBe(true);
      expect(
        screen.getByText(
          `${TEXT.duplicateTask}: ${TEXT.refusalReasons.implicitStart}`,
        ),
      ).toBeTruthy();
    });
  });

  it("moves a task to the end of another section", async () => {
    const rendered = await openGui();
    await pickTask(rendered, SPEC);
    const select = combobox(TEXT.moveToSectionField);
    const options = within(select)
      .getAllByRole("option")
      .map((option) => [option.textContent, option.hasAttribute("disabled")]);
    expect(options).toEqual([
      [TEXT.moveToSectionNone, false],
      ["Design", true],
      ["Build", false],
      ["Empty", false],
    ]);
    expect(isDisabled(button(TEXT.moveToSection))).toBe(true);
    await rendered.shell.user.selectOptions(select, "2");
    expect(isDisabled(button(TEXT.moveToSection))).toBe(false);
    await press(rendered, TEXT.moveToSection);
    expect(storedText(rendered)).toBe(
      GANTT.replace("    Spec :des1, 2024-01-01, 3d\n", "").replace(
        "    section Empty\n",
        "    section Empty\n    Spec :des1, 2024-01-01, 3d\n",
      ),
    );
  });
});

describe("links", () => {
  it("adds a link below the task, refuses a non-http one, and removes it", async () => {
    const rendered = await openGui();
    await pickTask(rendered, CODE);
    await enter(rendered, textbox(TEXT.linkField), "javascript:alert(1)");
    expect(screen.getByRole("alert").textContent).toContain(
      TEXT.refusalReasons.unsupportedScheme,
    );
    expect(storedText(rendered)).toBe(GANTT);
    await enter(rendered, textbox(TEXT.linkField), "https://example.com/spec");
    expect(storedText(rendered)).toContain(
      '    Code :b1, 2024-02-01, 5d\n    click b1 href "https://example.com/spec"\n',
    );
    await enter(rendered, textbox(TEXT.linkField), "");
    expect(storedText(rendered)).toBe(GANTT);
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("makes the link read-only for a task without an id", async () => {
    const rendered = await openGui();
    await pickTask(rendered, TEST);
    expect(textbox(TEXT.linkField).readOnly).toBe(true);
    expect(screen.getByText(TEXT.refusalReasons.noTaskId)).toBeTruthy();
  });
});
