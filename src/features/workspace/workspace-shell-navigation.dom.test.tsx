// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
} from "../../application/test-support/workspace-harness";
import { renderShell } from "./test-support/shell-harness";

afterEach(() => {
  cleanup();
});

const treeItem = (name: string | RegExp) =>
  screen.getByRole("treeitem", { name });
const documentTab = (name: string | RegExp) =>
  within(screen.getByRole("tablist", { name: "Document Tabs" })).getByRole(
    "tab",
    { name },
  );
const sheetTab = (name: string | RegExp) =>
  within(screen.getByRole("tablist", { name: "Sheet Tabs" })).getByRole("tab", {
    name,
  });

function isSelected(element: HTMLElement): boolean {
  return element.getAttribute("aria-selected") === "true";
}

describe("empty state and opening a project", () => {
  it("shows an empty state, then the documents in order after opening a project", async () => {
    const { openProjectInUi } = await renderShell();
    expect(screen.getByText("Projectが開かれていません")).toBeTruthy();
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.getByRole("button", { name: "新規Project" })).toBeTruthy();

    await openProjectInUi();

    const tree = screen.getByRole("tree", { name: "Project Tree" });
    const names = within(tree)
      .getAllByRole("treeitem")
      .map((item) => item.textContent ?? "");
    expect(names[0]).toContain("Project");
    expect(names[1]).toContain("Document A");
    expect(names[2]).toContain("Document B");
    expect(names[3]).toContain("読み込み失敗");
    // Unopened documents are single rows without children.
    for (const name of ["Document A", "Document B"]) {
      const item = treeItem(name);
      expect(within(item).queryAllByRole("treeitem")).toEqual([]);
      expect(item.getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.queryByRole("tablist", { name: "Document Tabs" })).toBeNull();
    expect(
      screen.getByText("Documentをツリーから開いてください。"),
    ).toBeTruthy();
  });

  it("places the theme settings in the top bar", async () => {
    await renderShell();
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
  });
});

describe("activating documents", () => {
  it("opens a tab, shows sheets in tree and tabs, and the placeholder, on click", async () => {
    const { user, openProjectInUi, gateway } = await renderShell();
    await openProjectInUi();

    await user.click(within(treeItem("Document A")).getByText("Document A"));

    await waitFor(() => expect(documentTab(/Document A/)).toBeTruthy());
    expect(isSelected(documentTab(/Document A/))).toBe(true);
    expect(treeItem("Document A").getAttribute("aria-expanded")).toBe("true");
    const sheetItems = within(treeItem("Document A")).getAllByRole("treeitem");
    expect(sheetItems.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Sheet A1"),
      expect.stringContaining("Sheet A2"),
      expect.stringContaining("読み込み失敗"),
    ]);
    expect(isSelected(treeItem("Sheet A1"))).toBe(true);
    expect(isSelected(sheetTab("Sheet A1"))).toBe(true);
    expect(sheetTab("Sheet A2")).toBeTruthy();
    // The sheet that failed to load is not a tab.
    expect(
      within(screen.getByRole("tablist", { name: "Sheet Tabs" })).getAllByRole(
        "tab",
      ),
    ).toHaveLength(2);
    expect(screen.getByRole("listbox", { name: "Sheet A1" })).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Sheet A1" })).toBeTruthy();
    expect(gateway.methods("loadDocument")).toEqual(["loadDocument"]);
  });

  it("opens with Enter and with ArrowRight on a focused tree item", async () => {
    const { user, openProjectInUi, store } = await renderShell();
    await openProjectInUi();

    treeItem("Document A").focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(store.getState().documents.has(DOCUMENT_A)).toBe(true),
    );

    treeItem("Document B").focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(store.getState().documents.has(DOCUMENT_B)).toBe(true),
    );
    expect(isSelected(documentTab(/Document B/))).toBe(true);
  });

  it("moves through the tree with the arrow keys, Home, End and ArrowLeft", async () => {
    const { user, openProjectInUi } = await renderShell();
    await openProjectInUi();
    await user.click(within(treeItem("Document A")).getByText("Document A"));
    await screen.findByRole("treeitem", { name: "Sheet A1" });

    treeItem("Document A").focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(treeItem("Sheet A1"));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(treeItem("Sheet A2"));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(treeItem("Document A"));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getAllByRole("treeitem").at(-1));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(treeItem("Project"));
  });

  it("does not open a document that failed to load, but offers to delete it", async () => {
    const { user, openProjectInUi, gateway, store } = await renderShell();
    await openProjectInUi();
    const failed = treeItem(/読み込み失敗/);
    expect(failed.getAttribute("aria-disabled")).toBe("true");

    await user.click(failed);
    failed.focus();
    await user.keyboard("{Enter}{ArrowRight}");

    expect(gateway.methods("loadDocument")).toEqual([]);
    expect(store.getState().documents.has(FAILED_DOCUMENT_ID)).toBe(false);
    expect(
      within(failed).getByRole("button", { name: "Documentを削除" }),
    ).toBeTruthy();
    expect(
      within(failed).queryByRole("button", { name: "Sheetを作成" }),
    ).toBeNull();
  });
});

describe("document tabs", () => {
  async function withTwoDocuments() {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await harness.user.click(
      within(treeItem("Document A")).getByText("Document A"),
    );
    await harness.user.click(
      within(treeItem("Document B")).getByText("Document B"),
    );
    await waitFor(() =>
      expect(isSelected(documentTab(/Document B/))).toBe(true),
    );
    return harness;
  }

  it("keeps several documents open and marks only the active tab", async () => {
    await withTwoDocuments();
    const tabs = within(
      screen.getByRole("tablist", { name: "Document Tabs" }),
    ).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Document A",
      "Document B",
    ]);
    expect(tabs.map(isSelected)).toEqual([false, true]);
    expect(screen.getByRole("tabpanel", { name: /Document B/ })).toBeTruthy();
  });

  it("switches by click and by arrow keys, Home and End", async () => {
    const { user } = await withTwoDocuments();

    await user.click(documentTab(/Document A/));
    expect(isSelected(documentTab(/Document A/))).toBe(true);
    expect(screen.getByRole("listbox", { name: "Sheet A1" })).toBeTruthy();

    documentTab(/Document A/).focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(isSelected(documentTab(/Document B/))).toBe(true),
    );
    expect(document.activeElement).toBe(documentTab(/Document B/));
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(isSelected(documentTab(/Document A/))).toBe(true),
    );
    await user.keyboard("{End}");
    await waitFor(() =>
      expect(isSelected(documentTab(/Document B/))).toBe(true),
    );
    await user.keyboard("{Home}");
    await waitFor(() =>
      expect(isSelected(documentTab(/Document A/))).toBe(true),
    );
  });

  it("closes a tab with its own button and activates the neighbour", async () => {
    const { user, store } = await withTwoDocuments();

    await user.click(
      screen.getByRole("button", { name: "Document Bを閉じる" }),
    );

    await waitFor(() =>
      expect(store.getState().documents.has(DOCUMENT_B)).toBe(false),
    );
    expect(isSelected(documentTab(/Document A/))).toBe(true);
    expect(screen.getByRole("listbox", { name: "Sheet A1" })).toBeTruthy();
    // The sheets of a closed document leave the tree.
    expect(within(treeItem("Document B")).queryAllByRole("treeitem")).toEqual(
      [],
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(documentTab(/Document A/)),
    );
  });

  it("keeps the close button outside the tab element", async () => {
    await withTwoDocuments();
    const closeButton = screen.getByRole("button", {
      name: "Document Aを閉じる",
    });
    expect(closeButton.closest('[role="tab"]')).toBeNull();
  });
});

describe("sheets", () => {
  it("keeps the tree selection and the sheet tabs in step", async () => {
    const { user, openProjectInUi } = await renderShell();
    await openProjectInUi();
    await user.click(within(treeItem("Document A")).getByText("Document A"));
    await screen.findByRole("treeitem", { name: "Sheet A2" });

    await user.click(within(treeItem("Sheet A2")).getByText("Sheet A2"));
    expect(isSelected(sheetTab("Sheet A2"))).toBe(true);
    expect(isSelected(treeItem("Sheet A2"))).toBe(true);
    expect(isSelected(treeItem("Sheet A1"))).toBe(false);
    expect(screen.getByRole("listbox", { name: "Sheet A2" })).toBeTruthy();

    await user.click(sheetTab("Sheet A1"));
    expect(isSelected(treeItem("Sheet A1"))).toBe(true);
    expect(screen.getByRole("listbox", { name: "Sheet A1" })).toBeTruthy();

    sheetTab("Sheet A1").focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(isSelected(sheetTab("Sheet A2"))).toBe(true));
    expect(document.activeElement).toBe(sheetTab("Sheet A2"));
    expect(
      within(screen.getByRole("tabpanel", { name: "Sheet A2" })).getByRole(
        "listbox",
        { name: "Sheet A2" },
      ),
    ).toBeTruthy();
  });

  it("restores the remembered sheet when switching back to a document", async () => {
    const { user, openProjectInUi } = await renderShell();
    await openProjectInUi();
    await user.click(within(treeItem("Document A")).getByText("Document A"));
    await user.click(within(treeItem("Sheet A2")).getByText("Sheet A2"));
    await user.click(within(treeItem("Document B")).getByText("Document B"));
    expect(screen.getByRole("listbox", { name: "Sheet B1" })).toBeTruthy();

    await user.click(documentTab(/Document A/));

    expect(screen.getByRole("listbox", { name: "Sheet A2" })).toBeTruthy();
    expect(isSelected(treeItem("Sheet A2"))).toBe(true);
  });
});
