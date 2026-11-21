// @vitest-environment jsdom
// A Document is renamed in its own tab (double-click or F2, as a sheet tab), and Ctrl+Tab /
// Ctrl+PageDown (Shift / PageUp backwards) go round the tabs from anywhere in the window.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { tabCycleStep } from "./document-tabs";
import { renderShell, treeItemNamed } from "./test-support/shell-harness";

afterEach(() => {
  cleanup();
});

const documentTabList = () =>
  screen.getByRole("tablist", { name: "Document Tabs" });
const tabElement = (name: string) =>
  within(documentTabList()).getByRole("tab", { name: new RegExp(name) });
const selectedTabName = () =>
  within(documentTabList())
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent?.replace(/保存.*|未保存/, "")
    .trim();

async function withTwoOpenDocuments() {
  const harness = await renderShell();
  await harness.openProjectInUi();
  for (const name of ["Document A", "Document B"]) {
    await harness.user.click(within(treeItemNamed(name)).getByText(name));
    await screen.findByRole("tab", { name: new RegExp(name) });
  }
  return harness;
}

describe("renaming a Document in its tab", () => {
  it("opens the input in the tab (not in the tree) on double-click and saves on Enter", async () => {
    const harness = await withTwoOpenDocuments();
    await harness.user.dblClick(tabElement("Document A"));
    const input = within(documentTabList()).getByRole("textbox");
    // Only one input: the tree does not open its own.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    await harness.user.clear(input);
    await harness.user.type(input, "Renamed A{Enter}");
    await waitFor(() => expect(tabElement("Renamed A")).toBeTruthy());
  });

  it("opens with F2 and leaves the name on Escape", async () => {
    const harness = await withTwoOpenDocuments();
    tabElement("Document B").focus();
    await harness.user.keyboard("{F2}");
    const input = within(documentTabList()).getByRole("textbox");
    await harness.user.type(input, "x{Escape}");
    expect(within(documentTabList()).queryByRole("textbox")).toBeNull();
    expect(tabElement("Document B")).toBeTruthy();
  });
});

describe("Ctrl+Tab", () => {
  it("goes to the next tab and round, and back with Shift", async () => {
    const harness = await withTwoOpenDocuments();
    expect(selectedTabName()).toBe("Document B");
    await harness.user.keyboard("{Control>}{Tab}{/Control}");
    await waitFor(() => expect(selectedTabName()).toBe("Document A"));
    await harness.user.keyboard("{Control>}{Shift>}{Tab}{/Shift}{/Control}");
    await waitFor(() => expect(selectedTabName()).toBe("Document B"));
    await harness.user.keyboard("{Control>}{PageUp}{/Control}");
    await waitFor(() => expect(selectedTabName()).toBe("Document A"));
  });

  it("tells which keys switch tabs", () => {
    expect(tabCycleStep("Tab", false)).toBe(1);
    expect(tabCycleStep("Tab", true)).toBe(-1);
    expect(tabCycleStep("PageDown", false)).toBe(1);
    expect(tabCycleStep("PageUp", false)).toBe(-1);
    expect(tabCycleStep("PageDown", true)).toBeNull();
    expect(tabCycleStep("a", false)).toBeNull();
  });
});
