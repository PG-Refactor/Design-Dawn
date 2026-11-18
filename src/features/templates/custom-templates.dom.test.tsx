// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import {
  blockOption,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import { openMenu } from "../workspace/test-support/menu-helpers";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import { TEMPLATE_MESSAGES } from "./template-messages";

const TEXTS = TEMPLATE_MESSAGES.ja;

afterEach(() => {
  cleanup();
});

async function saveFirstBlockAsTemplate(
  rendered: Awaited<ReturnType<typeof renderOpenedCanvas>>,
  name: string,
) {
  fireEvent.contextMenu(blockOption(0), { clientX: 5, clientY: 5 });
  await rendered.shell.user.click(
    within(screen.getByRole("menu")).getByRole("menuitem", {
      name: TEXTS.saveAsTemplate,
    }),
  );
  const dialog = screen.getByRole("dialog", {
    name: TEXTS.saveTitle(TEXTS.kinds.markdown),
  });
  await rendered.shell.user.type(
    within(dialog).getByRole("textbox", { name: TEXTS.nameLabel }),
    name,
  );
  await rendered.shell.user.click(
    within(dialog).getByRole("radio", { name: TEXTS.scopes.shared }),
  );
  await rendered.shell.user.click(
    within(dialog).getByRole("button", { name: TEXTS.save }),
  );
  await act(settle);
}

describe("custom templates in the app", () => {
  it("saves a block from its menu and adds it again from + Block", async () => {
    const rendered = await renderOpenedCanvas();
    await saveFirstBlockAsTemplate(rendered, "Minutes");
    expect(rendered.shell.templateGateway.stored[0]?.summary).toMatchObject({
      name: "Minutes",
      scope: "shared",
      kind: "markdown",
    });
    const before = screen.getAllByRole("option").length;
    await rendered.shell.user.click(
      screen.getByRole("button", { name: "+ Block" }),
    );
    await rendered.shell.user.click(
      screen.getByRole("menuitem", { name: TEXTS.fromTemplate }),
    );
    await rendered.shell.user.click(
      await screen.findByRole("menuitem", {
        name: `Minutes（${TEXTS.kinds.markdown}・${TEXTS.scopeShort.shared}）`,
      }),
    );
    await act(settle);
    expect(screen.getAllByRole("option")).toHaveLength(before + 1);
  });

  it("renames and deletes a template in the manager", async () => {
    const rendered = await renderOpenedCanvas();
    await saveFirstBlockAsTemplate(rendered, "Draft");
    const menu = await openMenu(
      rendered.shell.user,
      WORKSPACE_MESSAGES.ja.topBar.fileMenu,
    );
    await rendered.shell.user.click(
      within(menu).getByRole("menuitem", { name: TEXTS.manage }),
    );
    const manager = await screen.findByRole("dialog", {
      name: TEXTS.manageTitle,
    });
    await rendered.shell.user.click(
      within(manager).getByRole("button", { name: TEXTS.rename }),
    );
    const field = within(manager).getByRole("textbox", {
      name: TEXTS.nameLabel,
    });
    await rendered.shell.user.clear(field);
    await rendered.shell.user.type(field, "Final");
    await rendered.shell.user.click(
      within(manager).getByRole("button", { name: TEXTS.renameDone }),
    );
    await act(settle);
    expect(within(manager).getByText("Final")).toBeTruthy();
    await rendered.shell.user.click(
      within(manager).getByRole("button", { name: TEXTS.delete }),
    );
    await rendered.shell.user.click(
      within(manager).getByRole("button", { name: TEXTS.delete }),
    );
    await act(settle);
    expect(rendered.shell.templateGateway.stored).toEqual([]);
    expect(within(manager).getByText(TEXTS.emptyList)).toBeTruthy();
  });

  it("asks the name of a sheet made from a custom template", async () => {
    const rendered = await renderOpenedCanvas();
    await rendered.shell.services.templates.saveSheet(
      DOCUMENT_A,
      SHEET_A1,
      "project",
      "Layout",
    );
    await act(settle);
    const sheetTab = screen.getByRole("tab", { name: /Sheet A1/ });
    fireEvent.contextMenu(sheetTab, { clientX: 5, clientY: 5 });
    await rendered.shell.user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: TEXTS.sheetFromTemplate,
      }),
    );
    await rendered.shell.user.click(
      await screen.findByRole("menuitem", { name: /^Layout/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: TEXTS.sheetNameTitle("Layout"),
    });
    const field = within(dialog).getByRole("textbox", {
      name: TEXTS.sheetNameLabel,
    });
    // The template's sheet name to start with.
    expect((field as HTMLInputElement).value).toBe("Sheet A1");
    await rendered.shell.user.clear(field);
    await rendered.shell.user.type(field, "Layout copy");
    await rendered.shell.user.click(
      within(dialog).getByRole("button", { name: TEXTS.create }),
    );
    await act(settle);
    expect(screen.getByRole("tab", { name: /Layout copy/ })).toBeTruthy();
  });
});
