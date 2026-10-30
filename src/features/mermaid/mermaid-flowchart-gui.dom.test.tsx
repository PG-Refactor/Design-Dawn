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
const TEXT = GUI.flowchart;
const SHORT_ID = "00000001";
const FLOWCHART = [
  "flowchart LR",
  '  A["Start"] --> B(End)',
  "  B -.-> C{Choice}",
  "",
].join("\n");
const RESTRICTED = [
  "flowchart LR",
  "  A --> B & C",
  '  F["one"]',
  '  F["two"]',
  "  subgraph S [Group]",
  "    H",
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

async function openGui(source: string = FLOWCHART) {
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
const nodeList = () =>
  screen.getByRole("listbox", { name: TEXT.nodeListLabel(SHORT_ID) });
const edgeList = () =>
  screen.getByRole("listbox", { name: TEXT.edgeListLabel(SHORT_ID) });
const subgraphList = () =>
  screen.getByRole("listbox", { name: TEXT.subgraphListLabel(SHORT_ID) });
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

async function pickNode(rendered: Rendered, label: string, id: string) {
  await rendered.shell.user.click(
    within(nodeList()).getByRole("option", {
      name: TEXT.nodeOption(label, id),
    }),
  );
}
async function pickEdge(rendered: Rendered, name: string) {
  await rendered.shell.user.click(
    within(edgeList()).getByRole("option", { name }),
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
const edgeName = (start: string, end: string, label = "") =>
  TEXT.edgeOption(start, end, label);

async function saveAll(rendered: Rendered): Promise<OperationResult<void>> {
  let result: OperationResult<void> | undefined;
  await act(async () => {
    result = await rendered.shell.actions.saveAll();
    await settle();
  });
  if (result === undefined) throw new Error("saveAll did not finish");
  return result;
}

describe("the flowchart GUI lists", () => {
  it("shows nodes, edges and subgraphs of an editable flowchart", async () => {
    await openGui(RESTRICTED);
    expect(optionNames(nodeList())).toEqual([
      TEXT.nodeOption("A", "A"),
      TEXT.nodeOption("B", "B"),
      TEXT.nodeOption("C", "C"),
      TEXT.nodeOption("two", "F"),
      TEXT.nodeOption("H", "H"),
    ]);
    expect(optionNames(edgeList())).toEqual([
      edgeName("A", "B"),
      edgeName("A", "C"),
    ]);
    expect(optionNames(subgraphList())).toEqual([
      TEXT.subgraphOption("Group", "S", "H"),
    ]);
    expect(combobox(TEXT.directionLabel).value).toBe("LR");
  });

  it("selects with the keyboard and moves to the label on Enter", async () => {
    const rendered = await openGui();
    nodeList().focus();
    await rendered.shell.user.keyboard("{ArrowDown}");
    await act(settle);
    expect(
      within(nodeList())
        .getByRole("option", { name: TEXT.nodeOption("Start", "A") })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await rendered.shell.user.keyboard("{ArrowDown}{Enter}");
    await act(settle);
    expect(document.activeElement).toBe(textbox(TEXT.nodeLabelField));
    expect(textbox(TEXT.nodeLabelField).value).toBe("End");
  });
});

describe("each operation through the GUI", () => {
  it("changes the direction (one undo step)", async () => {
    const rendered = await openGui();
    await choose(rendered, combobox(TEXT.directionLabel), "TB");
    expect(storedText(rendered)).toBe(FLOWCHART.replace("LR", "TD"));
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("renames a node on Enter and one undo restores it", async () => {
    const rendered = await openGui();
    await pickNode(rendered, "End", "B");
    await enter(rendered, textbox(TEXT.nodeLabelField), "Finish <1>");
    expect(storedText(rendered)).toBe(
      FLOWCHART.replace("B(End)", 'B("Finish #lt;1#gt;")'),
    );
    expect(textbox(TEXT.nodeLabelField).value).toBe("Finish <1>");
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await act(async () => {
      await rendered.canvas.session.undo();
      await settle();
    });
    expect(storedText(rendered)).toBe(FLOWCHART);
    expect(textbox(TEXT.nodeLabelField).value).toBe("End");
  });

  it("changes a node's shape", async () => {
    const rendered = await openGui();
    await pickNode(rendered, "Start", "A");
    await choose(rendered, combobox(TEXT.shapeField), "circle");
    expect(storedText(rendered)).toBe(
      FLOWCHART.replace('A["Start"]', 'A(("Start"))'),
    );
  });

  it("adds a node with a label, an id and a shape, and selects it", async () => {
    const rendered = await openGui();
    await rendered.shell.user.type(
      textbox(TEXT.newNodeLabel),
      "Extra{Shift>}{Enter}{/Shift}two",
    );
    await rendered.shell.user.type(textbox(TEXT.newNodeId), "X1");
    await choose(rendered, combobox(TEXT.newNodeShape), "diamond");
    await rendered.shell.user.click(button(TEXT.addNode));
    await act(settle);
    expect(storedText(rendered)).toBe(`${FLOWCHART}  X1{"Extra<br/>two"}\n`);
    expect(textbox(TEXT.newNodeLabel).value).toBe("");
    expect(textbox(TEXT.nodeLabelField).value).toBe("Extra\ntwo");
  });

  it("adds an edge between two chosen nodes with a label", async () => {
    const rendered = await openGui();
    await choose(rendered, combobox(TEXT.newEdgeStart), "C");
    await choose(rendered, combobox(TEXT.newEdgeEnd), "A");
    await rendered.shell.user.type(textbox(TEXT.newEdgeLabel), "again{Enter}");
    await act(settle);
    expect(storedText(rendered)).toBe(`${FLOWCHART}  C -->|"again"| A\n`);
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("sets, changes and removes an edge label", async () => {
    const rendered = await openGui();
    await pickEdge(rendered, edgeName("Start", "End"));
    await enter(rendered, textbox(TEXT.edgeLabelField), "go");
    expect(storedText(rendered)).toBe(
      FLOWCHART.replace('A["Start"] --> B(End)', 'A["Start"] -->|"go"| B(End)'),
    );
    await enter(rendered, textbox(TEXT.edgeLabelField), "");
    expect(storedText(rendered)).toBe(FLOWCHART);
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("changes the arrow, the line and the length of an edge", async () => {
    const rendered = await openGui();
    await pickEdge(rendered, edgeName("End", "Choice"));
    await choose(rendered, combobox(TEXT.arrowField), "arrow_cross");
    expect(storedText(rendered)).toContain("B -.-x C{Choice}");
    await choose(rendered, combobox(TEXT.strokeField), "thick");
    expect(storedText(rendered)).toContain("B ==x C{Choice}");
    await choose(rendered, combobox(TEXT.lengthField), "2");
    expect(storedText(rendered)).toContain("B ===x C{Choice}");
    expect(await rendered.canvas.undoDepth()).toBe(3);
  });

  it("reconnects an end of an edge", async () => {
    const rendered = await openGui();
    await pickEdge(rendered, edgeName("End", "Choice"));
    await choose(rendered, combobox(TEXT.endField), "A");
    expect(storedText(rendered)).toContain("B -.-> A");
  });

  it("deletes an edge", async () => {
    const rendered = await openGui();
    await pickEdge(rendered, edgeName("End", "Choice"));
    await rendered.shell.user.click(button(TEXT.deleteEdge));
    await act(settle);
    expect(storedText(rendered)).not.toContain("-.->");
    expect(optionNames(edgeList())).toEqual([edgeName("Start", "End")]);
    expect(screen.queryByText(TEXT.selectedEdgeHeading)).toBeNull();
    await act(async () => {
      await rendered.canvas.session.undo();
      await settle();
    });
    expect(storedText(rendered)).toBe(FLOWCHART);
  });
});

describe("refusals", () => {
  it("shows the reason inline for a label with a double quote and keeps the input", async () => {
    const rendered = await openGui();
    await pickNode(rendered, "End", "B");
    await enter(rendered, textbox(TEXT.nodeLabelField), 'say "x"');
    expect(alertText()).toContain(GUI.refusalReasons.doubleQuote);
    expect(storedText(rendered)).toBe(FLOWCHART);
    expect(textbox(TEXT.nodeLabelField).value).toBe('say "x"');
    expect(await rendered.canvas.undoDepth()).toBe(0);
  });

  it("refuses an empty node label locally", async () => {
    const rendered = await openGui();
    await pickNode(rendered, "End", "B");
    await enter(rendered, textbox(TEXT.nodeLabelField), "");
    expect(alertText()).toContain(GUI.labelRequired);
    expect(storedText(rendered)).toBe(FLOWCHART);
  });

  it("refuses an id that is already used when adding a node", async () => {
    const rendered = await openGui();
    await rendered.shell.user.type(textbox(TEXT.newNodeLabel), "x");
    await rendered.shell.user.type(textbox(TEXT.newNodeId), "A{Enter}");
    await act(settle);
    expect(alertText()).toContain(GUI.refusalReasons.duplicateId);
    expect(storedText(rendered)).toBe(FLOWCHART);
    expect(textbox(TEXT.newNodeLabel).value).toBe("x");
  });

  it("asks for both endpoints when adding an edge", async () => {
    const rendered = await openGui();
    await choose(rendered, combobox(TEXT.newEdgeStart), "A");
    await rendered.shell.user.click(button(TEXT.addEdge));
    await act(settle);
    expect(alertText()).toContain(TEXT.endpointsRequired);
    expect(storedText(rendered)).toBe(FLOWCHART);
  });
});

describe("a flowchart the GUI cannot edit, or only in part", () => {
  it("explains an unsupported statement with its line and offers Source", async () => {
    const source = "flowchart LR\n  A --> B\n  ???\n";
    const rendered = await openGui(source);
    expect(screen.getByText(GUI.notEditableTitle)).toBeTruthy();
    expect(
      screen.getByText(GUI.notEditableReasons.unsupportedStatements),
    ).toBeTruthy();
    expect(screen.getByText(/line 3/)).toBeTruthy();
    expect(
      screen.queryByRole("listbox", { name: TEXT.nodeListLabel(SHORT_ID) }),
    ).toBeNull();
    await rendered.shell.user.click(button(GUI.switchToSource));
    expect(storedText(rendered)).toBe(source);
  });

  it("disables the controls of a node defined twice, with the reason", async () => {
    const rendered = await openGui(RESTRICTED);
    await pickNode(rendered, "two", "F");
    expect(
      screen.getByText(GUI.refusalReasons.multipleDefinitions),
    ).toBeTruthy();
    expect(textbox(TEXT.nodeLabelField).readOnly).toBe(true);
    expect(isDisabled(combobox(TEXT.shapeField))).toBe(true);
    await rendered.shell.user.selectOptions(
      combobox(TEXT.shapeField),
      "circle",
    );
    await act(settle);
    expect(storedText(rendered)).toBe(RESTRICTED);
  });

  it("disables every control of an edge from an A & B list", async () => {
    const rendered = await openGui(RESTRICTED);
    await pickEdge(rendered, edgeName("A", "B"));
    expect(screen.getAllByText(GUI.refusalReasons.sharedLink).length).toBe(2);
    expect(isDisabled(combobox(TEXT.arrowField))).toBe(true);
    expect(isDisabled(combobox(TEXT.endField))).toBe(true);
    expect(isDisabled(button(TEXT.deleteEdge))).toBe(true);
    await rendered.shell.user.click(button(TEXT.deleteEdge));
    await act(settle);
    expect(storedText(rendered)).toBe(RESTRICTED);
  });

  it("explains why the middle node of a chain cannot be reconnected", async () => {
    const rendered = await openGui("flowchart LR\n  A --> B --> C\n");
    await pickEdge(rendered, edgeName("A", "B"));
    expect(isDisabled(combobox(TEXT.startField))).toBe(false);
    expect(isDisabled(combobox(TEXT.endField))).toBe(true);
    expect(screen.getByText(TEXT.edgeEndShared)).toBeTruthy();
  });
});

describe("drafts", () => {
  it("keeps a typed label as a pending draft that save-all applies", async () => {
    const rendered = await openGui();
    await pickNode(rendered, "End", "B");
    type(textbox(TEXT.nodeLabelField), "Finish");
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(true);
    expect(storedText(rendered)).toBe(FLOWCHART);

    expect((await saveAll(rendered)).ok).toBe(true);
    expect(storedText(rendered)).toBe(
      FLOWCHART.replace("B(End)", 'B("Finish")'),
    );
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(
      false,
    );
  });

  it("commits a pending label when another element is chosen", async () => {
    const rendered = await openGui();
    await pickNode(rendered, "End", "B");
    type(textbox(TEXT.nodeLabelField), "Finish");
    await pickNode(rendered, "Start", "A");
    expect(storedText(rendered)).toContain('B("Finish")');
    expect(textbox(TEXT.nodeLabelField).value).toBe("Start");
  });

  it("commits a pending label when switching to Source", async () => {
    const rendered = await openGui();
    await pickNode(rendered, "End", "B");
    type(textbox(TEXT.nodeLabelField), "Finish");
    await rendered.shell.user.click(button(GUI.modeSource));
    await act(settle);
    expect(storedText(rendered)).toContain('B("Finish")');
    expect(
      (
        screen.getByRole("textbox", {
          name: MESSAGES.sourceLabel(SHORT_ID),
        }) as HTMLTextAreaElement
      ).value,
    ).toContain('B("Finish")');
  });

  it("stays in the GUI while an add form holds input, and does not add it", async () => {
    const rendered = await openGui();
    type(textbox(TEXT.newNodeLabel), "Half");
    await rendered.shell.user.click(button(GUI.modeSource));
    await act(settle);
    expect(alertText()).toContain(GUI.addInputPending);
    expect(storedText(rendered)).toBe(FLOWCHART);
    expect(textbox(TEXT.newNodeLabel).value).toBe("Half");
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(true);
  });

  it("adds a pending add form on save-all, an explicit save request", async () => {
    const rendered = await openGui();
    type(textbox(TEXT.newNodeLabel), "Saved");
    type(textbox(TEXT.newNodeId), "S1");
    expect((await saveAll(rendered)).ok).toBe(true);
    expect(storedText(rendered)).toBe(`${FLOWCHART}  S1["Saved"]\n`);
  });

  it("keeps the label when the element it belongs to changed underneath", async () => {
    const rendered = await openGui();
    await pickEdge(rendered, edgeName("End", "Choice"));
    type(textbox(TEXT.edgeLabelField), "maybe");
    await act(async () => {
      await rendered.canvas.canvasActions.commitContentEdit({
        documentId: DOCUMENT_A,
        sheetId: SHEET_A1,
        blockId: BLOCK_ONE,
        text: "flowchart LR\n  X --> Y\n  A --> B\n  B -.-> C\n",
      });
      await settle();
    });
    const result = await saveAll(rendered);
    expect(result.ok).toBe(false);
    expect(textbox(TEXT.edgeLabelField).value).toBe("maybe");
    expect(storedText(rendered)).not.toContain("maybe");
  });
});

const TIER_TWO = [
  "flowchart LR",
  '  A["Start"] --> B(End)',
  "  B -.-> C{Choice}",
  "  subgraph S [Group]",
  "    direction TB",
  "    H",
  "  end",
  "",
].join("\n");
const TWO_SUBGRAPHS = [
  "flowchart LR",
  "  A --> B",
  "  subgraph One",
  "    A",
  "  end",
  "  subgraph Two",
  "    B",
  "  end",
  "",
].join("\n");

const undo = async (rendered: Rendered): Promise<void> => {
  await act(async () => {
    await rendered.canvas.session.undo();
    await settle();
  });
};

describe("node deletion and membership through the GUI", () => {
  it("deletes a node with its edges, in one undo step, and clears the selection", async () => {
    const rendered = await openGui(TIER_TWO);
    await pickNode(rendered, "End", "B");
    expect(screen.getByText(TEXT.deleteNodeEdges(2))).toBeTruthy();
    await rendered.shell.user.click(button(TEXT.deleteNode));
    await act(settle);
    expect(storedText(rendered)).toBe(
      [
        "flowchart LR",
        '  A["Start"]',
        "  C{Choice}",
        "  subgraph S [Group]",
        "    direction TB",
        "    H",
        "  end",
        "",
      ].join("\n"),
    );
    expect(optionNames(nodeList())).toEqual([
      TEXT.nodeOption("Start", "A"),
      TEXT.nodeOption("Choice", "C"),
      TEXT.nodeOption("H", "H"),
    ]);
    expect(screen.queryByText(TEXT.selectedNodeHeading)).toBeNull();
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await undo(rendered);
    expect(storedText(rendered)).toBe(TIER_TWO);
  });

  it("disables the delete button with the reason the operation would give", async () => {
    const source = "flowchart LR\n  A --> B; linkStyle 0 stroke:red\n";
    const rendered = await openGui(source);
    await pickNode(rendered, "A", "A");
    expect(
      screen.getByText(GUI.refusalReasons.linkStyleSharesLine),
    ).toBeTruthy();
    expect(isDisabled(button(TEXT.deleteNode))).toBe(true);
    await rendered.shell.user.click(button(TEXT.deleteNode));
    await act(settle);
    expect(storedText(rendered)).toBe(source);
  });

  it("moves a node into a subgraph and takes it out again", async () => {
    const rendered = await openGui(TIER_TWO);
    await pickNode(rendered, "Start", "A");
    expect(combobox(TEXT.nodeSubgraphField).value).toBe("");
    await choose(rendered, combobox(TEXT.nodeSubgraphField), "S");
    expect(storedText(rendered)).toBe(
      TIER_TWO.replace("    H\n", "    H\n    A\n"),
    );
    expect(combobox(TEXT.nodeSubgraphField).value).toBe("S");
    await choose(rendered, combobox(TEXT.nodeSubgraphField), "");
    expect(storedText(rendered)).toBe(TIER_TWO);
    expect(await rendered.canvas.undoDepth()).toBe(2);
  });

  it("offers a subgraph that would be refused greyed out, with the reason in its text", async () => {
    const rendered = await openGui(TWO_SUBGRAPHS);
    await pickNode(rendered, "A", "A");
    const select = combobox(TEXT.nodeSubgraphField);
    expect(select.value).toBe("One");
    const two = within(select).getByRole("option", {
      name: TEXT.unavailableOption(
        TEXT.nodeOption("Two", "Two"),
        GUI.refusalReasons.firstDefinitionWins,
      ),
    }) as HTMLOptionElement;
    // One closes first, so it keeps A whatever Two says.
    expect(two.disabled).toBe(true);
    await pickNode(rendered, "B", "B");
    const forB = combobox(TEXT.nodeSubgraphField);
    expect(forB.value).toBe("Two");
    const one = within(forB).getByRole("option", {
      name: TEXT.nodeOption("One", "One"),
    }) as HTMLOptionElement;
    // Mentioning B in One makes One, which closes first, its owner.
    expect(one.disabled).toBe(false);
  });

  it("refuses to take out a node that is written inside an edge, and says why", async () => {
    const source = "flowchart LR\n  subgraph S\n    A --> B\n  end\n";
    const rendered = await openGui(source);
    await pickNode(rendered, "A", "A");
    const none = within(combobox(TEXT.nodeSubgraphField)).getByRole("option", {
      name: TEXT.unavailableOption(
        TEXT.nodeSubgraphNone,
        GUI.refusalReasons.mentionedInStatement,
      ),
    }) as HTMLOptionElement;
    expect(none.disabled).toBe(true);
    expect(storedText(rendered)).toBe(source);
  });
});

describe("subgraphs through the GUI", () => {
  it("renames a subgraph and sets its direction, one undo step each", async () => {
    const rendered = await openGui(TIER_TWO);
    await rendered.shell.user.click(
      within(subgraphList()).getByRole("option", {
        name: TEXT.subgraphOption("Group", "S", "H"),
      }),
    );
    expect(textbox(TEXT.subgraphTitleField).value).toBe("Group");
    expect(combobox(TEXT.subgraphDirectionField).value).toBe("TB");
    await enter(rendered, textbox(TEXT.subgraphTitleField), "Box <1>");
    expect(storedText(rendered)).toBe(
      TIER_TWO.replace("[Group]", '["Box #lt;1#gt;"]'),
    );
    await choose(rendered, combobox(TEXT.subgraphDirectionField), "LR");
    expect(storedText(rendered)).toContain("    direction LR\n");
    await choose(rendered, combobox(TEXT.subgraphDirectionField), "");
    expect(storedText(rendered)).not.toContain("direction");
    expect(await rendered.canvas.undoDepth()).toBe(3);
  });

  it("dissolves a subgraph, keeps what was inside, and undoes it in one step", async () => {
    const rendered = await openGui(TIER_TWO);
    await rendered.shell.user.click(
      within(subgraphList()).getByRole("option", {
        name: TEXT.subgraphOption("Group", "S", "H"),
      }),
    );
    expect(screen.getByText(TEXT.dissolveNote)).toBeTruthy();
    await rendered.shell.user.click(button(TEXT.dissolveSubgraph));
    await act(settle);
    expect(storedText(rendered)).toBe(
      [
        "flowchart LR",
        '  A["Start"] --> B(End)',
        "  B -.-> C{Choice}",
        "  H",
        "",
      ].join("\n"),
    );
    expect(screen.queryByText(TEXT.selectedSubgraphHeading)).toBeNull();
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await undo(rendered);
    expect(storedText(rendered)).toBe(TIER_TWO);
  });

  it("disables dissolving a subgraph whose id is named elsewhere, with the reason", async () => {
    const source = `${TIER_TWO}  class S hot\n`;
    const rendered = await openGui(source);
    await rendered.shell.user.click(
      within(subgraphList()).getByRole("option", {
        name: TEXT.subgraphOption("Group", "S", "H"),
      }),
    );
    expect(
      screen.getByText(GUI.refusalReasons.subgraphReferenced),
    ).toBeTruthy();
    expect(isDisabled(button(TEXT.dissolveSubgraph))).toBe(true);
    await rendered.shell.user.click(button(TEXT.dissolveSubgraph));
    await act(settle);
    expect(storedText(rendered)).toBe(source);
  });

  it("adds a subgraph with a title and a first member that no subgraph owns", async () => {
    const rendered = await openGui(TIER_TWO);
    const member = combobox(TEXT.newSubgraphMember);
    expect(
      within(member)
        .getAllByRole("option")
        .map((option) => (option as HTMLOptionElement).value),
    ).toEqual(["", "A", "B", "C"]);
    await rendered.shell.user.type(textbox(TEXT.newSubgraphTitle), "New box");
    await choose(rendered, member, "C");
    await rendered.shell.user.click(button(TEXT.addSubgraph));
    await act(settle);
    expect(storedText(rendered)).toBe(
      `${TIER_TWO}  subgraph S1["New box"]\n    C\n  end\n`,
    );
    expect(textbox(TEXT.newSubgraphTitle).value).toBe("");
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("asks for a title when adding a subgraph", async () => {
    const rendered = await openGui(TIER_TWO);
    await rendered.shell.user.click(button(TEXT.addSubgraph));
    await act(settle);
    expect(alertText()).toContain(GUI.labelRequired);
    expect(storedText(rendered)).toBe(TIER_TWO);
  });

  it("keeps the subgraph form as pending input that blocks the switch to Source", async () => {
    const rendered = await openGui(TIER_TWO);
    type(textbox(TEXT.newSubgraphTitle), "Half");
    await rendered.shell.user.click(button(GUI.modeSource));
    await act(settle);
    expect(alertText()).toContain(GUI.addInputPending);
    expect(textbox(TEXT.newSubgraphTitle).value).toBe("Half");
    expect(rendered.shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(true);
    expect((await saveAll(rendered)).ok).toBe(true);
    expect(storedText(rendered)).toBe(
      `${TIER_TWO}  subgraph S1["Half"]\n  end\n`,
    );
  });
});
