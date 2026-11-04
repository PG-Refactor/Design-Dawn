// @vitest-environment jsdom
// Right-click and click on the shapes of sequence, Gantt and pie diagrams in the GUI editor
// (the flowchart's are in mermaid-diagram-menu.dom.test.tsx).
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  objectUrls.restore();
});

const MESSAGES = MERMAID_MESSAGES.ja;
const GUI = MESSAGES.gui;
const SHORT_ID = "00000001";
// Every picture below is 200 x 100 and shown at that size.
const SHOWN = { width: 200, height: 100 };

async function openGui(source: string, svg: string) {
  const rendered = await renderOpenedCanvas(
    (harness: ActionsHarness): void => {
      const blocks = [makeBlockAt(1, 10, 20, "mermaid")];
      seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
      harness.gateway.files.set(blocks[0]?.contentPath ?? "", source);
    },
    { mermaidRenderer: createFakeRenderer(() => ({ ok: true, svg })) },
  );
  fireEvent.doubleClick(blockOption(0));
  await rendered.shell.user.click(
    screen.getByRole("button", { name: GUI.modeGui }),
  );
  await act(settle);
  return rendered;
}

async function picture(): Promise<HTMLImageElement> {
  const region = screen.getByRole("region", {
    name: MESSAGES.previewLabel(SHORT_ID),
  });
  const image = (await within(region).findByRole("img")) as HTMLImageElement;
  image.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      ...SHOWN,
      right: SHOWN.width,
      bottom: SHOWN.height,
      x: 0,
      y: 0,
    }) as DOMRect;
  return image;
}

function rightClick(target: HTMLElement, x: number, y: number): HTMLElement {
  fireEvent.contextMenu(target, { clientX: x, clientY: y, button: 2 });
  return screen.getByRole("menu", { name: GUI.diagramMenuLabel });
}

const itemNames = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);

async function choose(
  rendered: Awaited<ReturnType<typeof openGui>>,
  menu: HTMLElement,
  name: string,
) {
  await rendered.shell.user.click(within(menu).getByRole("menuitem", { name }));
  await act(settle);
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

const storedText = (rendered: Awaited<ReturnType<typeof openGui>>) =>
  rendered.canvas.session.getState().contents.get(BLOCK_ONE);

const focusedValue = () =>
  (document.activeElement as HTMLInputElement | HTMLTextAreaElement | null)
    ?.value;

describe("the sequence diagram's shapes", () => {
  const TEXT = GUI.sequence;
  const SOURCE = [
    "sequenceDiagram",
    "  participant A as Alice",
    "  participant B",
    "  A->>B: Hello",
    "  Note right of B: thinking",
    "  B-->>A: Hi",
    "",
  ].join("\n");
  // A's box (0..60, 0..20), B's box (120..180, 0..20); Hello along y = 40, the note
  // (130..190, 50..60), Hi along y = 80.
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" id="m" viewBox="0 0 200 100">
    <rect x="0" y="0" width="60" height="20" name="A" class="actor actor-top"/>
    <rect x="120" y="0" width="60" height="20" name="B" class="actor actor-top"/>
    <g data-et="note" data-id="i1"><rect x="130" y="50" width="60" height="10" class="note"/></g>
    <line x1="30" y1="40" x2="150" y2="40" data-et="message" data-id="i0"/>
    <line x1="150" y1="80" x2="30" y2="80" data-et="message" data-id="i2"/>
  </svg>`;

  it("offers a participant's actions and edits it", async () => {
    const rendered = await openGui(SOURCE, SVG);
    const menu = rightClick(await picture(), 10, 10);
    expect(itemNames(menu).slice(0, 2)).toEqual([
      TEXT.editParticipantMenu,
      TEXT.deleteParticipantMenu,
    ]);
    await choose(rendered, menu, TEXT.editParticipantMenu);
    expect(focusedValue()).toBe("Alice");
  });

  it("edits the second message and deletes it", async () => {
    const rendered = await openGui(SOURCE, SVG);
    const menu = rightClick(await picture(), 90, 81);
    expect(itemNames(menu).slice(0, 2)).toEqual([
      TEXT.editMessageMenu,
      TEXT.deleteMessageMenu,
    ]);
    await choose(rendered, menu, TEXT.editMessageMenu);
    expect(focusedValue()).toBe("Hi");
    await choose(
      rendered,
      rightClick(await picture(), 90, 81),
      TEXT.deleteMessageMenu,
    );
    expect(storedText(rendered)).not.toContain("Hi");
    expect(storedText(rendered)).toContain("A->>B: Hello");
  });

  it("deletes a note", async () => {
    const rendered = await openGui(SOURCE, SVG);
    const menu = rightClick(await picture(), 150, 55);
    expect(itemNames(menu).slice(0, 2)).toEqual([
      TEXT.editNoteMenu,
      TEXT.deleteNoteMenu,
    ]);
    await choose(rendered, menu, TEXT.deleteNoteMenu);
    expect(storedText(rendered)).not.toContain("thinking");
  });

  it("selects a message clicked in the diagram", async () => {
    await openGui(SOURCE, SVG);
    fireEvent.click(await picture(), { clientX: 90, clientY: 41 });
    await act(settle);
    expect(screen.getAllByDisplayValue("Hello").length).toBeGreaterThan(0);
  });
});

describe("the Gantt chart's tasks", () => {
  const TEXT = GUI.gantt;
  const SOURCE = [
    "gantt",
    "  dateFormat YYYY-MM-DD",
    "  section Design",
    "  Spec :s1, 2024-01-01, 3d",
    "  Review :2024-01-04, 2d",
    "",
  ].join("\n");
  // Spec's bar (10..90, 10..30) has its own id; Review's (90..150, 40..60) a made-up one.
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" id="m" viewBox="0 0 200 100">
    <rect id="m-s1" x="10" y="10" width="80" height="20" class="task task0"/>
    <rect id="m-task1" x="90" y="40" width="60" height="20" class="task task0"/>
  </svg>`;

  it("edits a task found by its place and deletes one found by its id", async () => {
    const rendered = await openGui(SOURCE, SVG);
    const menu = rightClick(await picture(), 100, 50);
    expect(itemNames(menu).slice(0, 2)).toEqual([
      TEXT.editTaskMenu,
      TEXT.deleteTaskMenu,
    ]);
    await choose(rendered, menu, TEXT.editTaskMenu);
    expect(focusedValue()).toBe("Review");
    await choose(
      rendered,
      rightClick(await picture(), 20, 20),
      TEXT.deleteTaskMenu,
    );
    expect(storedText(rendered)).not.toContain("Spec");
    expect(storedText(rendered)).toContain("Review");
  });
});

describe("the pie chart's slices", () => {
  const SOURCE = ["pie title Pets", '  "Dogs" : 60', '  "Cats" : 40', ""].join(
    "\n",
  );
  // Centred at (50, 50), r = 40: Dogs on the right half, Cats on the left; the legend at
  // x 150..160.
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" id="m" viewBox="0 0 200 100">
    <g transform="translate(50,50)">
      <path d="M0,-40A40,40,0,0,1,0,40L0,0Z" fill="#2859c0" class="pieCircle"/>
      <path d="M0,40A40,40,0,0,1,0,-40L0,0Z" fill="#1a7a4c" class="pieCircle"/>
      <g class="legend" transform="translate(100,-20)"><rect width="10" height="10" style="fill: rgb(40, 89, 192);"/><text>Dogs</text></g>
      <g class="legend" transform="translate(100,0)"><rect width="10" height="10" style="fill: rgb(26, 122, 76);"/><text>Cats</text></g>
    </g>
  </svg>`;

  it("edits a slice and deletes another from the picture or the legend", async () => {
    const rendered = await openGui(SOURCE, SVG);
    const menu = rightClick(await picture(), 30, 50);
    expect(itemNames(menu).slice(0, 2)).toEqual([
      GUI.editSliceMenu,
      GUI.deleteSliceMenu,
    ]);
    await choose(rendered, menu, GUI.editSliceMenu);
    expect(focusedValue()).toBe("Cats");
    // Dogs' legend entry.
    await choose(
      rendered,
      rightClick(await picture(), 155, 35),
      GUI.deleteSliceMenu,
    );
    expect(storedText(rendered)).not.toContain("Dogs");
    expect(storedText(rendered)).toContain("Cats");
  });
});
