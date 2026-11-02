// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderShell, treeItemNamed } from "./test-support/shell-harness";

afterEach(() => {
  cleanup();
});

describe("Document tabs and Sheet tabs are told apart", () => {
  it("puts the Sheet tabs below the sheet area and the Document tabs above it", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await harness.user.click(
      within(treeItemNamed("Document A")).getByText("Document A"),
    );
    await screen.findByRole("tab", { name: /Document A/ });
    const documentTabs = screen.getByRole("tablist", { name: "Document Tabs" });
    const sheetTabs = screen.getByRole("tablist", { name: "Sheet Tabs" });
    const sheetArea = screen.getByRole("listbox", { name: "Sheet A1" });
    const follows = (first: Node, second: Node) =>
      Boolean(
        first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    expect(follows(documentTabs, sheetArea)).toBe(true);
    expect(follows(sheetArea, sheetTabs)).toBe(true);
  });

  it("gives each kind of tab its own icon, outside the tab's name", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await harness.user.click(
      within(treeItemNamed("Document A")).getByText("Document A"),
    );
    const documentTab = await screen.findByRole("tab", { name: /Document A/ });
    const sheetTab = screen.getByRole("tab", { name: "Sheet A1" });
    const iconOf = (tab: HTMLElement) =>
      tab.querySelector(".tab__icon svg")?.innerHTML;
    expect(iconOf(documentTab)).toBeTruthy();
    expect(iconOf(sheetTab)).toBeTruthy();
    expect(iconOf(documentTab)).not.toBe(iconOf(sheetTab));
  });
});
