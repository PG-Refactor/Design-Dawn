// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renameSheetCommand } from "../../application/commands/naming-commands";
import { createFakeDocumentWindows } from "../../application/test-support/fake-document-windows";
import { displayName, settle } from "../../application/test-support/fakes";
import {
  createWorkspaceHarness,
  DOCUMENT_A,
  SELECTION_ID,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { renderShell, treeItemNamed } from "./test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

const MESSAGES = WORKSPACE_MESSAGES.ja;
const TABS = MESSAGES.tabs;

afterEach(() => {
  cleanup();
});

const documentTab = (name: RegExp) => screen.queryByRole("tab", { name });

function openTabMenu(name: RegExp): HTMLElement {
  const tab = documentTab(name);
  if (tab === null) throw new Error("no such tab");
  fireEvent.contextMenu(tab, { clientX: 1, clientY: 1, button: 2 });
  return screen.getByRole("menu");
}

describe("the Project window", () => {
  it("opens a Document that is not open in a new window from its tree menu", async () => {
    const first = createWorkspaceHarness();
    const windows = createFakeDocumentWindows(first.gateway);
    const shell = await renderShell({
      workspace: {
        sharedGateway: first.gateway,
        windows: windows.gatewayFor("main"),
      },
    });
    await shell.openProjectInUi();
    await shell.user.pointer({
      keys: "[MouseRight]",
      target: within(treeItemNamed("Document A")).getByText("Document A"),
    });
    await shell.user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: MESSAGES.tree.openInNewWindow,
      }),
    );
    await waitFor(() =>
      expect(windows.sent.map((sent) => sent.target.kind)).toEqual([
        "newWindow",
      ]),
    );
    expect(documentTab(/Document A/)).toBeNull();
  });

  it("moves a Document tab to a new window from its menu", async () => {
    const first = createWorkspaceHarness();
    const windows = createFakeDocumentWindows(first.gateway);
    const shell = await renderShell({
      workspace: {
        sharedGateway: first.gateway,
        windows: windows.gatewayFor("main"),
      },
    });
    await shell.openProjectInUi();
    await shell.user.click(
      within(treeItemNamed("Document A")).getByText("Document A"),
    );
    await screen.findByRole("tab", { name: /Document A/ });

    await shell.user.click(
      within(openTabMenu(/Document A/)).getByRole("menuitem", {
        name: TABS.moveToNewWindow,
      }),
    );

    await waitFor(() => expect(documentTab(/Document A/)).toBeNull());
    expect(windows.sent.map((sent) => sent.target.kind)).toEqual(["newWindow"]);
    // The tree still lists it: it is open in the other window.
    expect(treeItemNamed("Document A")).toBeTruthy();
  });

  it("opens a Document handed back to it, with what was done meanwhile", async () => {
    const first = createWorkspaceHarness();
    const windows = createFakeDocumentWindows(first.gateway);
    const shell = await renderShell({
      workspace: {
        sharedGateway: first.gateway,
        windows: windows.gatewayFor("main"),
      },
    });
    await shell.openProjectInUi();
    await act(async () => {
      await shell.actions.openDocument(DOCUMENT_A);
      await shell.actions.moveDocumentToWindow(DOCUMENT_A, {
        kind: "newWindow",
        screenX: null,
        screenY: null,
      });
    });
    // The Document window Rust made for it: it renames a sheet and hands it back.
    const other = createWorkspaceHarness({
      sharedGateway: first.gateway,
      windows: windows.gatewayFor("window-new-1"),
    });
    first.gateway.queueTransferRequest(windows.sent.at(-1)?.transferId ?? "");
    await other.workspace.openLaunchRequest();
    await other.workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheetCommand(SHEET_A1, displayName("Renamed")));
    await other.workspace.moveDocumentToWindow(DOCUMENT_A, {
      kind: "window",
      label: "main",
    });

    await act(async () => {
      shell.appRequestSource.emitWindowEvent({
        kind: "receiveDocument",
        transferId: windows.sent.at(-1)?.transferId ?? "",
      });
      await settle();
    });

    expect(await screen.findByRole("tab", { name: /Document A/ })).toBeTruthy();
    expect(
      shell.store.getState().documents.get(DOCUMENT_A)?.sheets.get(SHEET_A1)
        ?.name,
    ).toBe("Renamed");
  });
});

describe("a Document window", () => {
  it("shows the moved Document without a tree, and offers to move it back", async () => {
    const first = createWorkspaceHarness();
    const windows = createFakeDocumentWindows(first.gateway);
    windows.setWindows([
      { label: "main", role: "project" },
      { label: "window-new-1", role: "document" },
    ]);
    const main = createWorkspaceHarness({
      sharedGateway: first.gateway,
      windows: windows.gatewayFor("main"),
    });
    await main.workspace.openProject(SELECTION_ID);
    await main.workspace.openDocument(DOCUMENT_A);
    await main.workspace.moveDocumentToWindow(DOCUMENT_A, {
      kind: "newWindow",
      screenX: null,
      screenY: null,
    });
    first.gateway.queueTransferRequest(windows.sent.at(-1)?.transferId ?? "");

    await renderShell({
      workspace: {
        sharedGateway: first.gateway,
        windows: windows.gatewayFor("window-new-1"),
      },
    });

    expect(await screen.findByRole("tab", { name: /Document A/ })).toBeTruthy();
    expect(screen.queryByRole("tree")).toBeNull();
    const menu = openTabMenu(/Document A/);
    const names = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(names).not.toContain(MESSAGES.tree.rename);
    await waitFor(() =>
      expect(
        within(screen.getByRole("menu"))
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toContain(TABS.moveToProjectWindow),
    );
  });
});

describe("dragging a Document tab out of the window", () => {
  const POINTER_Y = 10;
  const OUTSIDE_X = -80;
  const SCREEN = { screenX: 640, screenY: 480 };

  async function projectWindowWithDocumentA() {
    const first = createWorkspaceHarness();
    const windows = createFakeDocumentWindows(first.gateway);
    const shell = await renderShell({
      workspace: {
        sharedGateway: first.gateway,
        windows: windows.gatewayFor("main"),
      },
    });
    await shell.openProjectInUi();
    await shell.user.click(
      within(treeItemNamed("Document A")).getByText("Document A"),
    );
    await screen.findByRole("tab", { name: /Document A/ });
    return { shell, windows };
  }

  // Press on the tab, move past the drag threshold, then out of the window and let go.
  async function dragOut(tab: HTMLElement): Promise<void> {
    const pointer = { pointerId: 1, isPrimary: true, button: 0 };
    await act(async () => {
      fireEvent.pointerDown(tab, {
        ...pointer,
        clientX: 5,
        clientY: POINTER_Y,
      });
      fireEvent.pointerMove(tab, {
        ...pointer,
        clientX: 60,
        clientY: POINTER_Y,
      });
      fireEvent.pointerMove(tab, {
        ...pointer,
        clientX: OUTSIDE_X,
        clientY: POINTER_Y,
      });
    });
    expect(tab.parentElement?.classList.contains("tab--detaching")).toBe(true);
    await act(async () => {
      fireEvent.pointerUp(tab, {
        ...pointer,
        clientX: OUTSIDE_X,
        clientY: POINTER_Y,
        ...SCREEN,
      });
      await settle();
    });
  }

  it("moves the Document to a new window where it was let go", async () => {
    const { windows } = await projectWindowWithDocumentA();
    const tab = documentTab(/Document A/);
    if (tab === null) throw new Error("no tab");

    await dragOut(tab);

    await waitFor(() => expect(documentTab(/Document A/)).toBeNull());
    expect(windows.sent.map((sent) => sent.target)).toEqual([
      { kind: "newWindow", ...SCREEN },
    ]);
  });

  it("moves the Document into the window of the Project it was let go over", async () => {
    const { windows } = await projectWindowWithDocumentA();
    windows.setWindowAtPoint("window-7");
    const tab = documentTab(/Document A/);
    if (tab === null) throw new Error("no tab");

    await dragOut(tab);

    await waitFor(() => expect(documentTab(/Document A/)).toBeNull());
    expect(windows.sent.map((sent) => sent.target)).toEqual([
      { kind: "window", label: "window-7" },
    ]);
  });

  it("leaves a Sheet tab dragged out where it was", async () => {
    const { windows } = await projectWindowWithDocumentA();
    const sheetTab = screen.getByRole("tab", { name: "Sheet A1" });
    const pointer = { pointerId: 1, isPrimary: true, button: 0 };
    await act(async () => {
      fireEvent.pointerDown(sheetTab, { ...pointer, clientX: 5, clientY: 5 });
      fireEvent.pointerMove(sheetTab, { ...pointer, clientX: 60, clientY: 5 });
      fireEvent.pointerUp(sheetTab, {
        ...pointer,
        clientX: OUTSIDE_X,
        clientY: 5,
        ...SCREEN,
      });
      await settle();
    });
    expect(windows.sent).toEqual([]);
    expect(screen.getByRole("tab", { name: "Sheet A1" })).toBeTruthy();
  });
});
