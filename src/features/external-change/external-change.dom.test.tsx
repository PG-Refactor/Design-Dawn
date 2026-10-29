// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangedFile } from "../../application/ports/persistence-types";
import { settle } from "../../application/test-support/fakes";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { makeDocumentADirty } from "../workspace/test-support/actions-harness";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";

afterEach(() => {
  cleanup();
});

const LANGUAGES = [
  { id: "ja", system: ["ja"], texts: WORKSPACE_MESSAGES.ja },
  { id: "en", system: ["en"], texts: WORKSPACE_MESSAGES.en },
] as const;

const SHEET_FILE: ChangedFile = {
  path: "sheets/a1/sheet.json",
  change: "modified",
  readable: true,
};

async function openedDocument(
  system: readonly string[],
): Promise<ShellHarness> {
  const shell = await renderShell({ systemLanguages: system });
  await shell.openProjectInUi();
  await act(async () => {
    await shell.actions.openDocument(DOCUMENT_A);
  });
  return shell;
}

async function pushChange(shell: ShellHarness, files: readonly ChangedFile[]) {
  const project = shell.store.getState().project;
  if (project === null) throw new Error("no project");
  await act(async () => {
    shell.appRequestSource.emitProjectFiles({
      projectId: project.projectId,
      changes: {
        sessionGeneration: project.sessionGeneration,
        watching: true,
        rescan: false,
        project: { structure: false, files: [] },
        documents: [{ documentId: DOCUMENT_A, files }],
      },
    });
    await settle();
  });
}

async function makeUnsaved(shell: ShellHarness) {
  await act(async () => {
    await shell.autoSaveController.setEnabled(false);
    await makeDocumentADirty(shell);
  });
}

describe.each(LANGUAGES)("external change UI ($id)", ({ system, texts }) => {
  const t = texts.externalChange;

  it("reads a Document without unsaved changes again and says so", async () => {
    const shell = await openedDocument(system);
    shell.gateway.clearCalls();
    await pushChange(shell, [SHEET_FILE]);
    expect(shell.gateway.methods("loadDocument")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(texts.notices.externalReloaded)).toBeTruthy();
    expect(shell.store.getState().documents.has(DOCUMENT_A)).toBe(true);
  });

  it("asks when there are unsaved changes, lists the files, and keeps on Escape", async () => {
    const shell = await openedDocument(system);
    await makeUnsaved(shell);
    await pushChange(shell, [SHEET_FILE]);

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: t.documentTitle("Document A"),
      }),
    ).toBeTruthy();
    expect(within(dialog).getByText(t.unsavedBody)).toBeTruthy();
    expect(within(dialog).getByText(SHEET_FILE.path)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: t.keepCurrent }),
    );

    fireEvent.keyDown(dialog, { key: "Escape" });
    await act(async () => settle());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(t.keptBanner)).toBeTruthy();
    // Saving stays stopped.
    const flushed = await shell.workspace
      .getDocumentSession(DOCUMENT_A)
      ?.flush();
    expect(flushed?.ok).toBe(false);
  });

  it("asks before throwing unsaved work away on Reload, with cancel focused", async () => {
    const shell = await openedDocument(system);
    await makeUnsaved(shell);
    await pushChange(shell, [SHEET_FILE]);
    shell.gateway.clearCalls();

    await shell.user.click(screen.getByRole("button", { name: t.reload }));
    const confirm = screen.getByRole("dialog");
    expect(within(confirm).getByText(t.reloadConfirmBody)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(confirm).getByRole("button", { name: t.cancel }),
    );
    expect(shell.gateway.methods("loadDocument")).toEqual([]);

    await shell.user.click(
      within(confirm).getByRole("button", { name: t.reloadConfirm }),
    );
    await act(async () => settle());
    expect(shell.gateway.methods("loadDocument")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.externalChangeController.store.getState().conflicts).toEqual(
      [],
    );
  });

  it("overwrites after a confirmation from the banner and saves again", async () => {
    const shell = await openedDocument(system);
    await makeUnsaved(shell);
    await pushChange(shell, [SHEET_FILE]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await act(async () => settle());
    shell.gateway.clearCalls();

    await shell.user.click(screen.getByRole("button", { name: t.overwrite }));
    const confirm = screen.getByRole("dialog");
    expect(within(confirm).getByText(t.overwriteConfirmBody)).toBeTruthy();
    expect(shell.gateway.methods("acceptDiskState")).toEqual([]);
    await shell.user.click(
      within(confirm).getByRole("button", { name: t.overwriteConfirm }),
    );
    await act(async () => settle());

    expect(shell.gateway.acceptedDiskStates).toEqual([DOCUMENT_A]);
    expect(shell.gateway.methods("saveSheet").length).toBeGreaterThan(0);
    expect(screen.queryByText(t.keptBanner)).toBeNull();
  });

  it("tells once that the watcher is not running", async () => {
    const shell = await openedDocument(system);
    const project = shell.store.getState().project;
    if (project === null) throw new Error("no project");
    const notice = {
      projectId: project.projectId,
      changes: {
        sessionGeneration: project.sessionGeneration,
        watching: false,
        rescan: false,
        project: { structure: false, files: [] },
        documents: [],
      },
    };
    await act(async () => {
      shell.appRequestSource.emitProjectFiles(notice);
      await settle();
    });
    expect(
      screen.getByText(texts.notices.externalWatchUnavailable),
    ).toBeTruthy();
  });

  it("checks everything when the window regains focus", async () => {
    const shell = await openedDocument(system);
    shell.gateway.clearCalls();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await settle();
    });
    expect(shell.gateway.methods("checkExternalChanges")).toHaveLength(1);
  });

  it("refreshes the Git status when a notice arrives", async () => {
    const shell = await openedDocument(system);
    const before = shell.gitGateway.calls.length;
    await pushChange(shell, []);
    expect(shell.gitGateway.calls.length).toBeGreaterThan(before);
  });
});
