// @vitest-environment jsdom
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

const GUI = MERMAID_MESSAGES.ja.gui;
const TEXT = GUI.flowchart;
const SHORT_ID = "00000001";
const FLOWCHART = [
  "flowchart LR",
  '  A["Start"] --> B(End)',
  "  B -.-> C{Choice}",
  "",
].join("\n");

async function openGui() {
  const renderer = createFakeRenderer();
  const rendered = await renderOpenedCanvas(
    (harness: ActionsHarness): void => {
      const blocks = [makeBlockAt(1, 10, 20, "mermaid")];
      seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
      harness.gateway.files.set(blocks[0]?.contentPath ?? "", FLOWCHART);
    },
    { mermaidRenderer: renderer },
  );
  fireEvent.doubleClick(blockOption(0));
  await rendered.shell.user.click(
    screen.getByRole("button", { name: GUI.modeGui }),
  );
  await act(settle);
  return { ...rendered, renderer };
}

const toolbar = () =>
  screen.getByRole("toolbar", { name: GUI.addToolbarLabel });
const toggle = (name: string) =>
  within(toolbar()).getByRole("button", { name });
const tab = (label: string) =>
  screen.getByRole("tab", { name: new RegExp(`^${label}`) });
// The folded lists / settings open from a quiet button above them.
const listsButton = () => screen.getByRole("button", { name: /^一覧（/ });
const settingsButton = () =>
  screen.getByRole("button", { name: TEXT.settingsHeading });

describe("the layout of the diagram GUI", () => {
  it("puts one add button per kind of element at the top, before the lists", async () => {
    await openGui();
    expect(
      within(toolbar())
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([TEXT.addNodeToggle, TEXT.addEdgeToggle, TEXT.addSubgraphToggle]);
    expect(
      toolbar().compareDocumentPosition(listsButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // No add form is open at first.
    expect(
      screen.queryByRole("textbox", { name: TEXT.newNodeLabel }),
    ).toBeNull();
  });

  it("opens one add form at a time, with the focus in its first field", async () => {
    const rendered = await openGui();
    await rendered.shell.user.click(toggle(TEXT.addNodeToggle));
    expect(toggle(TEXT.addNodeToggle).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: TEXT.newNodeLabel }),
    );
    await rendered.shell.user.click(toggle(TEXT.addEdgeToggle));
    expect(
      screen.queryByRole("textbox", { name: TEXT.newNodeLabel }),
    ).toBeNull();
    expect(
      screen.getByRole("combobox", { name: TEXT.newEdgeStart }),
    ).toBeTruthy();
    await rendered.shell.user.click(toggle(TEXT.addEdgeToggle));
    expect(toggle(TEXT.addEdgeToggle).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("keeps what was typed in a closed add form, and opens it when it blocks Source", async () => {
    const rendered = await openGui();
    await rendered.shell.user.click(toggle(TEXT.addNodeToggle));
    await rendered.shell.user.type(
      screen.getByRole("textbox", { name: TEXT.newNodeLabel }),
      "Half",
    );
    await rendered.shell.user.click(toggle(TEXT.addNodeToggle));
    expect(
      screen.queryByRole("textbox", { name: TEXT.newNodeLabel }),
    ).toBeNull();
    await rendered.shell.user.click(
      screen.getByRole("button", { name: GUI.modeSource }),
    );
    await act(settle);
    expect(screen.getByRole("alert").textContent).toContain(
      GUI.addInputPending,
    );
    const label = screen.getByRole("textbox", {
      name: TEXT.newNodeLabel,
    }) as HTMLTextAreaElement;
    expect(label.value).toBe("Half");
  });

  it("folds the lists and the settings away, naming the lists with their counts", async () => {
    const rendered = await openGui();
    expect(listsButton().textContent).toContain(
      GUI.listsSummary(
        `${TEXT.nodesHeading} 3 · ${TEXT.edgesHeading} 2 · ${TEXT.subgraphsHeading} 0`,
      ),
    );
    expect(listsButton().getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("tablist", { name: GUI.listTabsLabel }),
    ).toBeNull();
    expect(settingsButton().getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("combobox", { name: TEXT.directionLabel }),
    ).toBeNull();
    await rendered.shell.user.click(listsButton());
    expect(
      screen.getByRole("tablist", { name: GUI.listTabsLabel }),
    ).toBeTruthy();
  });

  it("shows one list at a time, with the number of elements on its tab", async () => {
    const rendered = await openGui();
    await rendered.shell.user.click(listsButton());
    expect(tab(TEXT.nodesHeading).getAttribute("aria-selected")).toBe("true");
    expect(tab(TEXT.nodesHeading).textContent).toBe(`${TEXT.nodesHeading}3`);
    expect(tab(TEXT.edgesHeading).textContent).toBe(`${TEXT.edgesHeading}2`);
    expect(
      screen.queryByRole("listbox", { name: TEXT.edgeListLabel(SHORT_ID) }),
    ).toBeNull();
    await rendered.shell.user.click(tab(TEXT.edgesHeading));
    expect(
      screen.getByRole("listbox", { name: TEXT.edgeListLabel(SHORT_ID) }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("listbox", { name: TEXT.nodeListLabel(SHORT_ID) }),
    ).toBeNull();
    // Arrow keys move between the tabs.
    tab(TEXT.edgesHeading).focus();
    await rendered.shell.user.keyboard("{ArrowRight}");
    expect(tab(TEXT.subgraphsHeading).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(document.activeElement).toBe(tab(TEXT.subgraphsHeading));
  });

  it("shows the editor of the selection above the lists", async () => {
    const rendered = await openGui();
    await rendered.shell.user.click(listsButton());
    await rendered.shell.user.click(
      within(
        screen.getByRole("listbox", { name: TEXT.nodeListLabel(SHORT_ID) }),
      ).getByRole("option", { name: TEXT.nodeOption("Start", "A") }),
    );
    const label = screen.getByRole("textbox", { name: TEXT.nodeLabelField });
    expect(
      label.compareDocumentPosition(listsButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the settings (direction) apart, after the lists", async () => {
    const rendered = await openGui();
    await rendered.shell.user.click(settingsButton());
    const settings = screen.getByRole("region", {
      name: TEXT.settingsHeading,
    });
    expect(
      within(settings).getByRole("combobox", { name: TEXT.directionLabel }),
    ).toBeTruthy();
  });

  it("adds in a dialog that previews the diagram after the add", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const rendered = await openGui();
    await rendered.shell.user.click(toggle(TEXT.addNodeToggle));
    const dialog = screen.getByRole("dialog", { name: TEXT.addNodeHeading });
    expect(within(dialog).getByText(GUI.addPreviewHeading)).toBeTruthy();
    await rendered.shell.user.type(
      within(dialog).getByRole("textbox", { name: TEXT.newNodeLabel }),
      "Pay",
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await settle();
    });
    // The preview draws the text with the new node, before anything is added.
    expect(
      rendered.renderer.calls.some((call) => call.source.includes('"Pay"')),
    ).toBe(true);
    const blockId = rendered.canvas.blocksOfSheetA1()[0]?.blockId;
    if (blockId === undefined) throw new Error("the block is expected");
    expect(rendered.canvas.session.getState().contents.get(blockId)).toBe(
      FLOWCHART,
    );
    await rendered.shell.user.click(
      within(dialog).getByRole("button", { name: TEXT.addNode }),
    );
    await act(settle);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(toggle(TEXT.addNodeToggle));
    // The editor is still open.
    expect(
      screen.getByRole("toolbar", { name: GUI.addToolbarLabel }),
    ).toBeTruthy();
    vi.useRealTimers();
  });

  it("clears the form and closes on Cancel, so Source is not blocked", async () => {
    const rendered = await openGui();
    await rendered.shell.user.click(toggle(TEXT.addNodeToggle));
    const dialog = screen.getByRole("dialog");
    await rendered.shell.user.type(
      within(dialog).getByRole("textbox", { name: TEXT.newNodeLabel }),
      "Half",
    );
    await rendered.shell.user.click(
      within(dialog).getByRole("button", { name: GUI.addCancel }),
    );
    await act(settle);
    expect(screen.queryByRole("dialog")).toBeNull();
    await rendered.shell.user.click(toggle(TEXT.addNodeToggle));
    expect(
      (
        screen.getByRole("textbox", {
          name: TEXT.newNodeLabel,
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("");
    await rendered.shell.user.keyboard("{Escape}");
    await act(settle);
    expect(screen.queryByRole("dialog")).toBeNull();
    await rendered.shell.user.click(
      screen.getByRole("button", { name: GUI.modeSource }),
    );
    await act(settle);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the controls beside the diagram", () => {
  it("come after the diagram, and fold away and back while adding still works", async () => {
    const { shell } = await openGui();
    const panel = screen.getByRole("region", {
      name: GUI.panelLabel(SHORT_ID),
    });
    const gui = panel.closest(".text-block-editor__gui");
    const body = gui?.parentElement;
    // The diagram (left) comes first, the controls (right) after it.
    expect(body?.firstElementChild?.className).toBe(
      "text-block-editor__preview",
    );
    await shell.user.click(
      screen.getByRole("button", { name: GUI.hideControls }),
    );
    expect(gui?.hasAttribute("hidden")).toBe(true);
    // Still mounted: the toolbar is there, only not shown.
    expect(
      screen.getByRole("toolbar", { name: GUI.addToolbarLabel, hidden: true }),
    ).toBeTruthy();
    await shell.user.click(
      screen.getByRole("button", { name: GUI.showControls }),
    );
    expect(gui?.hasAttribute("hidden")).toBe(false);
  });
});

describe("the view the editor opens in", () => {
  it("is the one last chosen with the switch", async () => {
    const { shell } = await openGui();
    await shell.user.click(
      screen.getByRole("button", { name: GUI.modeSource }),
    );
    await act(settle);
    await shell.user.click(
      screen.getByRole("button", { name: MERMAID_MESSAGES.ja.done }),
    );
    await act(settle);
    fireEvent.doubleClick(blockOption(0));
    await act(settle);
    expect(
      screen
        .getByRole("button", { name: GUI.modeSource })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("with the controls folded away", () => {
  it("keeps editing after a node is added from the diagram's menu", async () => {
    const { shell } = await openGui();
    await shell.user.click(
      screen.getByRole("button", { name: GUI.hideControls }),
    );
    const dialogLayer = () =>
      document.querySelector<HTMLElement>(".diagram-add-dialog__layer");
    // The menu item opens the add form the same way the folded "+ Node" toggle does.
    const toggleButton = screen.getByRole("button", {
      name: TEXT.addNodeToggle,
      hidden: true,
    });
    fireEvent.click(toggleButton);
    expect(dialogLayer()?.hidden).toBe(false);
    const dialog = screen.getByRole("dialog");
    await shell.user.type(
      within(dialog).getAllByRole("textbox")[0] as HTMLElement,
      "Added",
    );
    await shell.user.click(
      within(dialog).getByRole("button", { name: TEXT.addNode }),
    );
    await act(settle);
    expect(dialogLayer()?.hidden).toBe(true);
    // Still editing: the bar's switch is there and the focus stayed in the editor.
    expect(screen.getByRole("button", { name: GUI.showControls })).toBeTruthy();
    expect(
      document.activeElement?.closest("[data-block-editor]"),
    ).not.toBeNull();
  });
});

describe("typing a label in the add dialog", () => {
  it("shows no error for a blank on the way to the next word", async () => {
    const { shell } = await openGui();
    await shell.user.click(toggle(TEXT.addNodeToggle));
    const dialog = screen.getByRole("dialog");
    await shell.user.type(
      within(dialog).getAllByRole("textbox")[0] as HTMLElement,
      "Echo ",
    );
    await act(settle);
    expect(
      within(dialog).queryByText(GUI.refusalReasons.labelNotTrimmed),
    ).toBeNull();
    await shell.user.type(
      within(dialog).getAllByRole("textbox")[0] as HTMLElement,
      "two",
    );
    await act(settle);
    expect(
      within(dialog).queryByText(GUI.refusalReasons.labelNotTrimmed),
    ).toBeNull();
  });

  it("tells in the dialog why an add was refused (a blank left at the end)", async () => {
    const { shell } = await openGui();
    await shell.user.click(toggle(TEXT.addNodeToggle));
    const dialog = screen.getByRole("dialog");
    const label = within(dialog).getAllByRole("textbox")[0] as HTMLElement;
    await shell.user.type(label, "Echo ");
    await act(settle);
    await shell.user.type(label, "{Enter}");
    await act(settle);
    expect(
      within(dialog).getByText(GUI.refusalReasons.labelNotTrimmed, {
        exact: false,
      }),
    ).toBeTruthy();
  });
});
