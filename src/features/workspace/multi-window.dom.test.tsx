// @vitest-environment jsdom

import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPEN_IN_NEW_WINDOW_STATUS } from "../../application/ports/persistence-types";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
} from "../../application/test-support/workspace-harness";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import { makeDocumentADirty } from "./test-support/actions-harness";
import { chooseMenuItem } from "./test-support/menu-helpers";
import { chooseRowMenuItem, renderShell } from "./test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

const MESSAGES = WORKSPACE_MESSAGES.ja;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const REQUEST = "request-1";
const OTHER_REQUEST = "request-2";
const TOKEN = "token-1";

const documentTab = (name: string) =>
  within(screen.getByRole("tablist", { name: "Document Tabs" })).getByRole(
    "tab",
    { name },
  );

async function emitOpenDocument(
  shell: Awaited<ReturnType<typeof renderShell>>,
  requestId: string,
  documentId: typeof DOCUMENT_A,
): Promise<void> {
  await act(async () => {
    shell.appRequestSource.emit({ requestId, documentId });
    await settle();
  });
}

describe("open in a new window", () => {
  it("is offered next to open / create when no Project is open", async () => {
    const shell = await renderShell();
    await chooseMenuItem(
      shell.user,
      MESSAGES.topBar.fileMenu,
      MESSAGES.topBar.openProjectInNewWindow,
    );
    await settle();

    expect(shell.gateway.methods()).toEqual([
      "takeOpenRequest",
      "selectProjectFolder",
      "openProjectInNewWindow",
    ]);
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("stays in the top bar while a Project is open, and leaves that Project alone", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    shell.gateway.clearCalls();

    await chooseMenuItem(
      shell.user,
      MESSAGES.topBar.fileMenu,
      MESSAGES.topBar.openProjectInNewWindow,
    );
    await settle();

    expect(shell.gateway.methods()).toEqual([
      "selectProjectFolder",
      "openProjectInNewWindow",
    ]);
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("is in the Project menu of the tree, and leaves the open Project alone", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    shell.gateway.clearCalls();

    await chooseRowMenuItem(
      shell.user,
      "Project",
      MESSAGES.tree.openProjectInNewWindow,
    );
    await settle();

    expect(shell.gateway.methods()).toEqual([
      "selectProjectFolder",
      "openProjectInNewWindow",
    ]);
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("shows a light notice when a window already has the Project, and clears it", async () => {
    const shell = await renderShell();
    shell.gateway.setOpenInNewWindowResult({
      status: OPEN_IN_NEW_WINDOW_STATUS.focusedExisting,
      inThisWindow: false,
    });
    await chooseMenuItem(
      shell.user,
      MESSAGES.topBar.fileMenu,
      MESSAGES.topBar.openProjectInNewWindow,
    );

    const notice = await screen.findByText(
      MESSAGES.notices.projectOpenInOtherWindow,
    );
    expect(notice).toBeTruthy();
    // Non-modal and not a failure: no dialog, nothing in the error count.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("settingsChanged notifications from Rust", () => {
  it("applies the theme, language, text size and auto-save of another window to this window's controllers", async () => {
    const shell = await renderShell();
    await act(settle);

    await act(async () => {
      shell.appRequestSource.emitSettings({
        themePreference: "dark",
        languagePreference: "ja",
        textSize: "large",
        autoSave: false,
      });
    });

    expect(shell.services.themeController.store.getState().preference).toBe(
      "dark",
    );
    expect(shell.services.languageController.store.getState().preference).toBe(
      "ja",
    );
    expect(shell.services.textSizeController.store.getState().size).toBe(
      "large",
    );
    expect(shell.services.autoSaveController.store.getState().enabled).toBe(
      false,
    );
  });

  it("does not change the Project Tree width of this window", async () => {
    const shell = await renderShell();
    await act(settle);
    const before =
      shell.services.layoutSettingsController.store.getState().projectTreeWidth;

    await act(async () => {
      shell.appRequestSource.emitSettings({
        themePreference: "light",
        languagePreference: "system",
        textSize: "medium",
        autoSave: true,
      });
    });

    expect(
      shell.services.layoutSettingsController.store.getState().projectTreeWidth,
    ).toBe(before);
  });

  it("subscribes once and unsubscribes when the shell goes away", async () => {
    const shell = await renderShell();
    expect(shell.appRequestSource.settingsListenerCount()).toBe(1);
    cleanup();
    expect(shell.appRequestSource.settingsListenerCount()).toBe(0);
  });
});

describe("openDocument requests from Rust", () => {
  it("opens the document, activates its tab and acknowledges", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();

    await emitOpenDocument(shell, REQUEST, DOCUMENT_B);

    expect(documentTab("Document B").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(shell.appRequestSource.acknowledgedIds).toEqual([REQUEST]);
  });

  it("activates an open document and says it is already open", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    await emitOpenDocument(shell, REQUEST, DOCUMENT_A);
    await emitOpenDocument(shell, OTHER_REQUEST, DOCUMENT_B);

    await emitOpenDocument(shell, "request-3", DOCUMENT_A);

    expect(documentTab("Document A").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText(MESSAGES.notices.documentAlreadyOpen)).toBeTruthy();
    expect(shell.appRequestSource.acknowledgedIds).toEqual([
      REQUEST,
      OTHER_REQUEST,
      "request-3",
    ]);
  });

  it("clears the notice after its duration", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    await emitOpenDocument(shell, REQUEST, DOCUMENT_A);
    const timers = vi.spyOn(globalThis, "setTimeout");
    await emitOpenDocument(shell, OTHER_REQUEST, DOCUMENT_A);
    expect(screen.getByText(MESSAGES.notices.documentAlreadyOpen)).toBeTruthy();
    const expire = timers.mock.calls.find(
      ([, delay]) => delay === LAYOUT_CONFIG.noticeDurationMs,
    )?.[0];
    expect(expire).toBeDefined();

    await act(async () => {
      (expire as () => void)();
    });

    expect(screen.queryByText(MESSAGES.notices.documentAlreadyOpen)).toBeNull();
  });

  it("subscribes once and unsubscribes when the shell goes away", async () => {
    const shell = await renderShell();
    expect(shell.appRequestSource.listenerCount()).toBe(1);
    cleanup();
    expect(shell.appRequestSource.listenerCount()).toBe(0);
  });

  it("waits while the window is closing and handles the request after the close was cancelled", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    await emitOpenDocument(shell, "opened-first", DOCUMENT_A);
    // Auto-save off with unsaved changes: the close asks first and stays "closing" meanwhile.
    await act(async () => {
      await shell.autoSaveController.setEnabled(false);
    });
    await makeDocumentADirty(shell);
    await act(async () => {
      shell.closeRequestSource.emit({ subscriptionToken: TOKEN });
      await settle();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();

    await emitOpenDocument(shell, REQUEST, DOCUMENT_B);

    // Neither handled nor acknowledged: Rust re-routes it if the window is destroyed.
    expect(shell.appRequestSource.acknowledgedIds).toEqual(["opened-first"]);
    expect(screen.queryByRole("tab", { name: /Document B/ })).toBeNull();

    await shell.user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: MESSAGES.dialogs.cancel,
      }),
    );
    await act(settle);

    expect(shell.appRequestSource.acknowledgedIds).toEqual([
      "opened-first",
      REQUEST,
    ]);
    expect(documentTab("Document B").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(shell.closeRequestSource.confirmedTokens).toEqual([]);
  });
});
