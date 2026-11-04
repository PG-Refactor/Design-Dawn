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
// What the renderer draws for it, as Mermaid lays nodes out: A at (0..80, 0..30),
// B at (100..180, 0..30), C as a diamond around (140, 70). The picture is shown at 200x100.
const DIAGRAM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g class="nodes">
    <g class="node default" id="m-flowchart-A-0" transform="translate(40, 15)">
      <rect class="basic label-container" x="-40" y="-15" width="80" height="30"/>
    </g>
    <g class="node default" id="m-flowchart-B-1" transform="translate(140, 15)">
      <rect class="basic label-container" x="-40" y="-15" width="80" height="30"/>
    </g>
    <g class="node default" id="m-flowchart-C-2" transform="translate(140, 70)">
      <polygon points="0,-20 20,0 0,20 -20,0"/>
    </g>
  </g>
</svg>`;
const SHOWN = { left: 0, top: 0, width: 200, height: 100 };

// The same nodes with A and B in a subgraph, and the two edges drawn as lines: A -> B
// along y = 15 between x 80 and 100, B -> C down x = 140 from y 30 to 50. The subgraph's
// area is (0..190, 0..45).
const GROUPED_FLOWCHART = [
  "flowchart LR",
  "  subgraph grp [Group]",
  '    A["Start"] --> B(End)',
  "  end",
  "  B -.-> C{Choice}",
  "",
].join("\n");
const GROUPED_DIAGRAM = `<svg xmlns="http://www.w3.org/2000/svg" id="m" viewBox="0 0 200 100">
  <g class="clusters">
    <g class="cluster" id="m-grp"><rect x="0" y="0" width="190" height="45"/></g>
  </g>
  <g class="edgePaths">
    <path d="M80,15L100,15" data-edge="true" data-id="L_A_B_0"/>
    <path d="M140,30L140,50" data-edge="true" data-id="L_B_C_0"/>
  </g>
  ${DIAGRAM.slice(DIAGRAM.indexOf('<g class="nodes">'), DIAGRAM.lastIndexOf("</svg>"))}
</svg>`;

async function openGui(source = FLOWCHART, svg = DIAGRAM) {
  const rendered = await renderOpenedCanvas(
    (harness: ActionsHarness): void => {
      const blocks = [makeBlockAt(1, 10, 20, "mermaid")];
      seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
      harness.gateway.files.set(blocks[0]?.contentPath ?? "", source);
    },
    {
      mermaidRenderer: createFakeRenderer(() => ({ ok: true, svg })),
    },
  );
  fireEvent.doubleClick(blockOption(0));
  await rendered.shell.user.click(
    screen.getByRole("button", { name: GUI.modeGui }),
  );
  await act(settle);
  return rendered;
}

// The picture of the diagram, laid out as jsdom cannot: shown at SHOWN.
async function picture(): Promise<HTMLImageElement> {
  const region = screen.getByRole("region", {
    name: MESSAGES.previewLabel(SHORT_ID),
  });
  const image = (await within(region).findByRole("img")) as HTMLImageElement;
  image.getBoundingClientRect = () =>
    ({
      ...SHOWN,
      right: SHOWN.width,
      bottom: SHOWN.height,
      x: 0,
      y: 0,
    }) as DOMRect;
  return image;
}

function rightClick(
  target: HTMLElement,
  x: number,
  y: number,
): HTMLElement | null {
  fireEvent.contextMenu(target, { clientX: x, clientY: y, button: 2 });
  return screen.queryByRole("menu", { name: GUI.diagramMenuLabel });
}

const itemNames = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);

const storedText = (rendered: Awaited<ReturnType<typeof openGui>>) =>
  rendered.canvas.session.getState().contents.get(BLOCK_ONE);

describe("right-clicking the diagram in the GUI editor", () => {
  it("offers to add what the diagram can hold, and opens that form", async () => {
    const rendered = await openGui();
    const menu = rightClick(await picture(), 190, 95);
    if (menu === null) throw new Error("no menu");
    expect(itemNames(menu)).toEqual([
      TEXT.addNodeHeading,
      TEXT.addEdgeHeading,
      TEXT.addSubgraphHeading,
    ]);
    await rendered.shell.user.click(
      within(menu).getByRole("menuitem", { name: TEXT.addNodeHeading }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: TEXT.newNodeLabel }),
    );
  });

  it("offers a node's own actions first on the node, and deletes it", async () => {
    const rendered = await openGui();
    const menu = rightClick(await picture(), 20, 10);
    if (menu === null) throw new Error("no menu");
    expect(itemNames(menu).slice(0, 3)).toEqual([
      TEXT.editNodeMenu,
      TEXT.addEdgeFromNodeMenu,
      TEXT.deleteNodeMenu,
    ]);
    await rendered.shell.user.click(
      within(menu).getByRole("menuitem", { name: TEXT.deleteNodeMenu }),
    );
    await act(settle);
    expect(storedText(rendered)).not.toContain("Start");
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("starts an edge from the node", async () => {
    const rendered = await openGui();
    const menu = rightClick(await picture(), 140, 70);
    if (menu === null) throw new Error("no menu");
    await rendered.shell.user.click(
      within(menu).getByRole("menuitem", { name: TEXT.addEdgeFromNodeMenu }),
    );
    const start = screen.getByRole("combobox", {
      name: TEXT.newEdgeStart,
    }) as HTMLSelectElement;
    expect(start.value).toBe("C");
  });

  it("edits the node: selected, with its label field focused", async () => {
    const rendered = await openGui();
    const menu = rightClick(await picture(), 150, 10);
    if (menu === null) throw new Error("no menu");
    await rendered.shell.user.click(
      within(menu).getByRole("menuitem", { name: TEXT.editNodeMenu }),
    );
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const label = screen.getByRole("textbox", {
      name: TEXT.nodeLabelField,
    }) as HTMLTextAreaElement;
    expect(label.value).toBe("End");
    expect(document.activeElement).toBe(label);
  });

  it("selects a node clicked in the diagram", async () => {
    await openGui();
    fireEvent.click(await picture(), { clientX: 20, clientY: 10 });
    await act(settle);
    const label = screen.getByRole("textbox", {
      name: TEXT.nodeLabelField,
    }) as HTMLTextAreaElement;
    expect(label.value).toBe("Start");
  });

  it("is an ordinary picture in Source view", async () => {
    const rendered = await openGui();
    await rendered.shell.user.click(
      screen.getByRole("button", { name: GUI.modeSource }),
    );
    await act(settle);
    expect(rightClick(await picture(), 20, 10)).toBeNull();
  });

  it("offers an edge's actions on its line, and deletes it", async () => {
    const rendered = await openGui(GROUPED_FLOWCHART, GROUPED_DIAGRAM);
    const menu = rightClick(await picture(), 90, 17);
    if (menu === null) throw new Error("no menu");
    expect(itemNames(menu).slice(0, 2)).toEqual([
      TEXT.editEdgeMenu,
      TEXT.deleteEdgeMenu,
    ]);
    await rendered.shell.user.click(
      within(menu).getByRole("menuitem", { name: TEXT.deleteEdgeMenu }),
    );
    await act(settle);
    expect(storedText(rendered)).not.toContain("-->");
    expect(storedText(rendered)).toContain("B -.-> C");
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("offers a subgraph's actions on its area, and removes it keeping its nodes", async () => {
    const rendered = await openGui(GROUPED_FLOWCHART, GROUPED_DIAGRAM);
    const menu = rightClick(await picture(), 90, 40);
    if (menu === null) throw new Error("no menu");
    expect(itemNames(menu).slice(0, 2)).toEqual([
      TEXT.editSubgraphMenu,
      TEXT.dissolveSubgraphMenu,
    ]);
    await rendered.shell.user.click(
      within(menu).getByRole("menuitem", { name: TEXT.dissolveSubgraphMenu }),
    );
    await act(settle);
    expect(storedText(rendered)).not.toContain("subgraph");
    expect(storedText(rendered)).toContain('A["Start"] --> B(End)');
  });

  it("selects a subgraph clicked in the diagram", async () => {
    await openGui(GROUPED_FLOWCHART, GROUPED_DIAGRAM);
    fireEvent.click(await picture(), { clientX: 90, clientY: 40 });
    await act(settle);
    const title = screen.getByRole("textbox", {
      name: TEXT.subgraphTitleField,
    }) as HTMLInputElement;
    expect(title.value).toBe("Group");
  });
});
