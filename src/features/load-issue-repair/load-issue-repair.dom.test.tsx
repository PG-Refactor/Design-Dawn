// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadIssue } from "../../application/ports/persistence-types";
import { settle } from "../../application/test-support/fakes";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { makeDocumentADirty } from "../workspace/test-support/actions-harness";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";

afterEach(() => cleanup());

const LANGUAGES = [
  { id: "ja", system: ["ja"], texts: WORKSPACE_MESSAGES.ja },
  { id: "en", system: ["en"], texts: WORKSPACE_MESSAGES.en },
] as const;

const issue = (overrides: Partial<LoadIssue>): LoadIssue => ({
  kind: "unlistedEntity",
  path: "documents/unlisted",
  entityId: null,
  detail: "d",
  reason: null,
  ...overrides,
});

async function shellWith(system: readonly string[], issues: LoadIssue[]) {
  const shell = await renderShell({
    systemLanguages: system,
    projectIssues: issues,
  });
  await shell.openProjectInUi();
  act(() => shell.actions.setNotificationsOpen(true));
  return shell;
}

const applied = (shell: ShellHarness) =>
  shell.gateway.repairRequests.filter((request) => !request.dryRun);

describe.each(LANGUAGES)("Load Issue repair UI ($id)", ({ system, texts }) => {
  const t = texts.loadIssueRepair;

  it("plans, confirms and then repairs and reads the Project again", async () => {
    const shell = await shellWith(system, [issue({})]);
    shell.gateway.setRepairOutcome({
      applied: false,
      files: ["project.json"],
      unavailable: null,
      issues: [],
    });
    await shell.user.click(
      screen.getByRole("button", { name: t.actions.addToList }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("project.json")).toBeTruthy();
    expect(applied(shell)).toHaveLength(0);
    shell.gateway.clearCalls();
    await shell.user.click(
      within(dialog).getByRole("button", { name: t.confirmLabels.run }),
    );
    await act(async () => settle());
    expect(applied(shell)).toHaveLength(1);
    expect(
      shell.gateway.methods("openProject", "reloadProject").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes nothing when cancelled", async () => {
    const shell = await shellWith(system, [issue({})]);
    await shell.user.click(
      screen.getByRole("button", { name: t.actions.addToList }),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await act(async () => settle());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(applied(shell)).toHaveLength(0);
  });

  it("explains an unavailable repair", async () => {
    const shell = await shellWith(system, [issue({})]);
    shell.gateway.setRepairOutcome({
      applied: false,
      files: [],
      unavailable: "ambiguousReference",
      issues: [],
    });
    await shell.user.click(
      screen.getByRole("button", { name: t.actions.addToList }),
    );
    expect(
      screen.getByText(t.unavailableReasons.ambiguousReference),
    ).toBeTruthy();
  });

  it("offers only Reload for a load failure, and nothing for a read-only newer file", async () => {
    await shellWith(system, [
      issue({ kind: "unrecognizedDirectory", path: "documents/odd" }),
      issue({
        kind: "entityLoadFailed",
        path: "documents/new/document.json",
        reason: "unsupportedSchemaVersion",
      }),
    ]);
    const itemWith = (text: string): HTMLElement =>
      screen
        .getAllByRole("listitem")
        .find((item) => item.textContent?.includes(text)) as HTMLElement;
    const readOnly = itemWith(texts.notifications.readOnlyHint);
    expect(
      within(readOnly).queryByRole("button", { name: t.reload }),
    ).toBeNull();
    const odd = itemWith("documents/odd");
    expect(within(odd).getByRole("button", { name: t.reload })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: t.actions.addToList }),
    ).toBeNull();
  });

  it("lists older-format files once and updates them all after confirming", async () => {
    const shell = await shellWith(system, [
      issue({ kind: "outdatedFormat", path: "project.json" }),
    ]);
    expect(screen.getByText(texts.notifications.formatUpdate)).toBeTruthy();
    shell.gateway.setFormatUpdate({ updated: ["project.json"] });
    await shell.user.click(
      screen.getByRole("button", { name: t.updateFormat }),
    );
    await shell.user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t.confirmLabels.updateFormat,
      }),
    );
    await act(async () => settle());
    expect(shell.gateway.formatUpdateCalls).toBe(1);
  });

  it("saves unsaved work first when confirming a Document repair", async () => {
    const shell = await shellWith(system, []);
    await act(async () => {
      await shell.actions.openDocument(DOCUMENT_A);
    });
    await act(async () => {
      await shell.autoSaveController.setEnabled(false);
      await makeDocumentADirty(shell);
    });
    await shell.user.click(
      screen.getByRole("button", { name: t.actions.deleteFile }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(t.saveFirst)).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: t.confirmLabels.saveAndRun }),
    ).toBeTruthy();
  });
});
