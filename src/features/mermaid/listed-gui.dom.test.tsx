// @vitest-environment jsdom
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
import { LISTED_GUI_MESSAGES } from "./listed-gui-messages";
import {
  createFakeRenderer,
  installObjectUrlFake,
  type ObjectUrlFake,
} from "./test-support/fake-mermaid-renderer";

const TEXTS = LISTED_GUI_MESSAGES.ja;
let objectUrls: ObjectUrlFake;

beforeEach(() => {
  objectUrls = installObjectUrlFake();
});

afterEach(() => {
  cleanup();
  objectUrls.restore();
});

function seedMermaid(source: string) {
  return (harness: ActionsHarness): void => {
    const blocks = [makeBlockAt(1, 10, 20, "mermaid"), makeBlockAt(2, 300, 40)];
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
    harness.gateway.files.set(blocks[0]?.contentPath ?? "", source);
  };
}

async function openEditor(source: string) {
  const rendered = await renderOpenedCanvas(seedMermaid(source), {
    mermaidRenderer: createFakeRenderer(),
  });
  fireEvent.doubleClick(blockOption(0));
  await act(settle);
  return rendered;
}

const stored = (rendered: Awaited<ReturnType<typeof openEditor>>) =>
  rendered.canvas.session.getState().contents.get(BLOCK_ONE);

describe("the ER diagram editor", () => {
  it("lists entities and adds one, writing one line", async () => {
    const rendered = await openEditor(
      "erDiagram\n    CUSTOMER ||--o{ ORDER : places\n",
    );
    const entities = screen.getByRole("list", { name: TEXTS.er.entities });
    expect(
      within(entities)
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual([
      `CUSTOMER${TEXTS.er.attributeCount(0)}`,
      `ORDER${TEXTS.er.attributeCount(0)}`,
    ]);
    const form = screen.getByRole("form", { name: TEXTS.er.addEntity });
    await rendered.shell.user.type(
      within(form).getByRole("textbox", { name: TEXTS.er.entityName }),
      "PRODUCT",
    );
    await rendered.shell.user.click(
      within(form).getByRole("button", { name: TEXTS.add }),
    );
    await act(settle);
    expect(stored(rendered)).toBe(
      "erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    PRODUCT\n",
    );
  });

  it("explains a refused operation and changes nothing", async () => {
    const source = "erDiagram\n    CUSTOMER ||--o{ ORDER : places\n";
    const rendered = await openEditor(source);
    await rendered.shell.user.click(
      screen.getByRole("button", { name: /^ORDER/ }),
    );
    await rendered.shell.user.click(
      screen.getByRole("button", { name: TEXTS.er.deleteEntity }),
    );
    await act(settle);
    expect(stored(rendered)).toBe(source);
    expect(document.body.textContent).toContain(TEXTS.reasons.entityInUse);
  });
});

describe("the state diagram editor", () => {
  it("adds a transition chosen from the states", async () => {
    const rendered = await openEditor("stateDiagram-v2\n    [*] --> Draft\n");
    const form = screen.getByRole("form", { name: TEXTS.state.addTransition });
    await rendered.shell.user.selectOptions(
      within(form).getByRole("combobox", { name: TEXTS.state.from }),
      "Draft",
    );
    await rendered.shell.user.selectOptions(
      within(form).getByRole("combobox", { name: TEXTS.state.to }),
      "[*]",
    );
    await rendered.shell.user.click(
      within(form).getByRole("button", { name: TEXTS.add }),
    );
    await act(settle);
    expect(stored(rendered)).toBe(
      "stateDiagram-v2\n    [*] --> Draft\n    Draft --> [*]\n",
    );
  });
});

describe("the class diagram editor", () => {
  it("adds a member to the chosen class", async () => {
    const rendered = await openEditor(
      "classDiagram\n    class Order {\n        +id: string\n    }\n",
    );
    await rendered.shell.user.click(
      screen.getByRole("button", { name: /^Order/ }),
    );
    const form = screen.getByRole("form", { name: TEXTS.class.addMember });
    await rendered.shell.user.type(
      within(form).getByRole("textbox", { name: TEXTS.class.member }),
      "+place()",
    );
    await rendered.shell.user.click(
      within(form).getByRole("button", { name: TEXTS.add }),
    );
    await act(settle);
    expect(stored(rendered)).toBe(
      "classDiagram\n    class Order {\n        +id: string\n        +place()\n    }\n",
    );
  });
});
