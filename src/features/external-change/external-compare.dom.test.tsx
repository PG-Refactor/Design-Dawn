// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BlockContentComparison,
  ChangedFile,
} from "../../application/ports/persistence-types";
import { settle } from "../../application/test-support/fakes";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { renderOpenedCanvas } from "../markdown/test-support/markdown-harness";
import { COMPARE_PANEL_ID } from "../workspace/tab-ids";
import { makeDocumentADirty } from "../workspace/test-support/actions-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";

afterEach(() => {
  cleanup();
});

const T = WORKSPACE_MESSAGES.ja.externalChange;
const DIFF = [
  "--- disk",
  "+++ memory",
  "@@ -1,1 +1,1 @@",
  "-text on disk",
  "+text in memory",
  "",
].join("\n");

// A Document with unsaved changes whose first Block's text file changed on disk, with the
// question showing.
async function conflictOnTextFile(comparison: BlockContentComparison) {
  const rendered = await renderOpenedCanvas();
  const { shell, canvas } = rendered;
  const contentPath = canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
  shell.gateway.setComparison(comparison);
  await act(async () => {
    await shell.autoSaveController.setEnabled(false);
    await makeDocumentADirty(shell);
  });
  const project = shell.store.getState().project;
  if (project === null) throw new Error("no project");
  const file: ChangedFile = {
    path: contentPath,
    change: "modified",
    readable: true,
  };
  await act(async () => {
    shell.appRequestSource.emitProjectFiles({
      projectId: project.projectId,
      changes: {
        sessionGeneration: project.sessionGeneration,
        watching: true,
        rescan: false,
        project: { structure: false, files: [] },
        documents: [{ documentId: DOCUMENT_A, files: [file] }],
      },
    });
    await settle();
  });
  return { ...rendered, contentPath };
}

const comparePanel = (): HTMLElement => {
  const panel = document.getElementById(COMPARE_PANEL_ID);
  if (panel === null) throw new Error("no compare panel");
  return panel;
};

describe("comparing an externally changed text file", () => {
  it("offers the comparison first and opens a compare tab with the diff", async () => {
    const { shell, contentPath } = await conflictOnTextFile({
      outcome: "text",
      diff: DIFF,
    });
    const dialog = screen.getByRole("dialog");
    const compare = within(dialog).getAllByRole("button", {
      name: T.compare,
    })[0];
    expect(document.activeElement).toBe(compare);

    await shell.user.click(compare as HTMLElement);
    await act(async () => settle());

    // The question steps aside; the compare tab carries the way to decide.
    expect(screen.queryByRole("dialog")).toBeNull();
    const fileName = contentPath.split("/").at(-1) ?? "";
    const tab = screen.getByRole("tab", {
      name: new RegExp(T.compareTabTitle(fileName)),
    });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const panel = comparePanel();
    expect(within(panel).getByText("text on disk")).toBeTruthy();
    expect(within(panel).getByText("text in memory")).toBeTruthy();
    expect(
      within(panel).getByText(new RegExp(T.compareDraftNotice)),
    ).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: T.keepCurrent }),
    ).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: T.overwrite }),
    ).toBeTruthy();
    expect(within(panel).getByRole("button", { name: T.reload })).toBeTruthy();

    // The committed text of the Block was what was sent, and the conflict is unchanged.
    expect(shell.gateway.comparedTexts).toHaveLength(1);
    expect(
      shell.externalChangeController.store.getState().conflicts[0]?.status,
    ).toBe("conflict");
  });

  it("asks the question again when the compare tab is closed without deciding", async () => {
    const { shell } = await conflictOnTextFile({ outcome: "text", diff: DIFF });
    await shell.user.click(
      within(screen.getByRole("dialog")).getAllByRole("button", {
        name: T.compare,
      })[0] as HTMLElement,
    );
    await act(async () => settle());
    await shell.user.click(
      screen.getByRole("button", { name: T.compareClose }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("decides from the compare tab", async () => {
    const { shell } = await conflictOnTextFile({ outcome: "text", diff: DIFF });
    await shell.user.click(
      within(screen.getByRole("dialog")).getAllByRole("button", {
        name: T.compare,
      })[0] as HTMLElement,
    );
    await act(async () => settle());
    await shell.user.click(
      within(comparePanel()).getByRole("button", {
        name: T.keepCurrent,
      }),
    );
    expect(
      shell.externalChangeController.store.getState().conflicts[0]?.status,
    ).toBe("kept");
  });

  it("says so when the file is deleted on disk or the texts are the same", async () => {
    const removed = await conflictOnTextFile({ outcome: "removedOnDisk" });
    await removed.shell.user.click(
      within(screen.getByRole("dialog")).getAllByRole("button", {
        name: T.compare,
      })[0] as HTMLElement,
    );
    await act(async () => settle());
    expect(screen.getByText(T.compareRemovedOnDisk)).toBeTruthy();
    cleanup();

    const identical = await conflictOnTextFile({ outcome: "identical" });
    await identical.shell.user.click(
      within(screen.getByRole("dialog")).getAllByRole("button", {
        name: T.compare,
      })[0] as HTMLElement,
    );
    await act(async () => settle());
    expect(screen.getByText(T.compareIdentical)).toBeTruthy();
  });

  it("closes the compare tab with its Document", async () => {
    const { shell } = await conflictOnTextFile({ outcome: "text", diff: DIFF });
    await shell.user.click(
      within(screen.getByRole("dialog")).getAllByRole("button", {
        name: T.compare,
      })[0] as HTMLElement,
    );
    await act(async () => settle());
    await act(async () => {
      await shell.workspace.closeDocument(DOCUMENT_A, { discardChanges: true });
    });
    expect(shell.uiStateStore.getState().compareTab).toBeNull();
    expect(shell.uiStateStore.getState().activeMainTab.kind).toBe("document");
  });

  it("shows metadata files without a comparison and says lines cannot be compared", async () => {
    const rendered = await renderOpenedCanvas();
    const { shell } = rendered;
    await act(async () => {
      await shell.autoSaveController.setEnabled(false);
      await makeDocumentADirty(shell);
    });
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
          documents: [
            {
              documentId: DOCUMENT_A,
              files: [
                {
                  path: "sheets/a1/sheet.json",
                  change: "modified",
                  readable: true,
                },
              ],
            },
          ],
        },
      });
      await settle();
    });
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(new RegExp(T.compareJsonUnsupported)),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: T.compare }),
    ).toBeNull();
    // Without something to compare, the first focus is on keeping the current content.
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: T.keepCurrent }),
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
  });
});
