// @vitest-environment jsdom
// A diff of a file inside a Sheet: switched between text and looks; the looks show both
// versions with what changed listed; "Open Sheet" goes to the changed Block in the Project.
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GitSheetVersions } from "../../application/ports/git-gateway";
import { makeBlockAt, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { makeSheetWith } from "../../domain/shared/test-fixtures";
import { seedSheetBlocks } from "../workspace/test-support/actions-harness";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { openDiffPinned } from "./git-diff-session";
import { GIT_MESSAGES } from "./git-messages";

afterEach(cleanup);

const MESSAGES = GIT_MESSAGES.ja.sheetDiff;
const SHEET_FILE = "documents/a/sheets/a1/sheet.json";
const KEPT = makeBlockAt(1, 0, 0);
const ADDED = makeBlockAt(2, 300, 0);

function versions(): GitSheetVersions {
  return {
    documentId: DOCUMENT_A,
    before: {
      sheet: makeSheetWith(SHEET_A1, [KEPT]),
      texts: { [KEPT.contentPath]: "# same" },
      images: {},
    },
    after: {
      sheet: makeSheetWith(SHEET_A1, [KEPT, ADDED]),
      texts: { [KEPT.contentPath]: "# same", [ADDED.contentPath]: "# new" },
      images: {},
    },
  };
}

async function openSheetDiff(path = SHEET_FILE): Promise<ShellHarness> {
  const shell = await renderShell({
    seed: (harness) =>
      seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, [KEPT, ADDED]),
  });
  shell.gitGateway.status = {
    repositoryState: "ready",
    branch: null,
    files: [
      {
        path,
        indexStatus: "unmodified",
        worktreeStatus: "modified",
        originalPath: null,
      },
    ],
  };
  shell.gitGateway.sheetVersionsAnswer = versions();
  shell.gitGateway.diffs[`unstaged:${path}`] = {
    path,
    side: "unstaged",
    outcome: "text",
    diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`,
  };
  await shell.openProjectInUi();
  // The Git view reads the status, which a diff tab follows.
  await shell.user.click(
    within(
      screen.getByRole("tablist", { name: "左パネルの表示切り替え" }),
    ).getByRole("tab", { name: "Git" }),
  );
  await screen.findByRole("heading", { name: GIT_MESSAGES.ja.changeListLabel });
  await act(async () => {
    openDiffPinned(shell, { path, side: "unstaged" });
    await settle();
  });
  return shell;
}

describe("visual sheet diff", () => {
  it("offers Text and Looks for a file inside a Sheet, and shows both versions", async () => {
    const shell = await openSheetDiff();
    const modes = screen.getByRole("group", { name: MESSAGES.modeGroup });
    const looks = within(modes).getByRole("button", { name: MESSAGES.visual });
    expect(
      within(modes)
        .getByRole("button", { name: MESSAGES.text })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await shell.user.click(looks);
    await screen.findByText(MESSAGES.summary(1, 0, 0, 0));
    expect(
      screen.getByRole("region", { name: MESSAGES.paneLabel(MESSAGES.before) }),
    ).toBeTruthy();
    const after = screen.getByRole("region", {
      name: MESSAGES.paneLabel(MESSAGES.after),
    });
    // The added Block is marked on the later version.
    expect(within(after).getByText(MESSAGES.added)).toBeTruthy();
    expect(
      within(
        screen.getByRole("list", { name: MESSAGES.listLabel }),
      ).getAllByRole("button"),
    ).toHaveLength(1);
  });

  it("opens the Sheet in the Project at the changed Block", async () => {
    const shell = await openSheetDiff();
    await shell.user.click(
      screen.getByRole("button", { name: MESSAGES.openSheet }),
    );
    await waitFor(() =>
      expect(shell.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_A),
    );
    const selected = shell.uiStateStore
      .getState()
      .selectionBySheet.get(SHEET_A1);
    expect(selected?.has(ADDED.blockId)).toBe(true);
  });

  it("goes to the Block a changed text file belongs to", async () => {
    const shell = await openSheetDiff(`documents/a/${KEPT.contentPath}`);
    await shell.user.click(
      screen.getByRole("button", { name: MESSAGES.openSheet }),
    );
    await waitFor(() =>
      expect(
        shell.uiStateStore
          .getState()
          .selectionBySheet.get(SHEET_A1)
          ?.has(KEPT.blockId),
      ).toBe(true),
    );
  });

  it("shows the picture a Markdown text had at the earlier version", async () => {
    const OLD_PICTURE = "data:image/png;base64,T0xE";
    const shell = await renderShell({
      seed: (harness) =>
        seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, [KEPT, ADDED]),
    });
    shell.gitGateway.status = {
      repositoryState: "ready",
      branch: null,
      files: [
        {
          path: SHEET_FILE,
          indexStatus: "unmodified",
          worktreeStatus: "modified",
          originalPath: null,
        },
      ],
    };
    const text = "![p](../../../assets/pic.png)";
    shell.gitGateway.sheetVersionsAnswer = {
      ...versions(),
      before: {
        sheet: makeSheetWith(SHEET_A1, [KEPT]),
        texts: { [KEPT.contentPath]: text },
        images: { "assets/pic.png": OLD_PICTURE },
      },
    };
    shell.gitGateway.diffs[`unstaged:${SHEET_FILE}`] = {
      path: SHEET_FILE,
      side: "unstaged",
      outcome: "empty",
    };
    shell.uiStateStore.setState((state) => ({
      ...state,
      diffContentMode: "visual",
    }));
    await shell.openProjectInUi();
    await act(async () => {
      openDiffPinned(shell, { path: SHEET_FILE, side: "unstaged" });
      await settle();
    });
    const before = await screen.findByRole("region", {
      name: MESSAGES.paneLabel(MESSAGES.before),
    });
    await waitFor(() =>
      expect(before.querySelector("img")?.getAttribute("src")).toBe(
        OLD_PICTURE,
      ),
    );
  });

  it("offers neither for a file outside a Sheet", async () => {
    await openSheetDiff("documents/a/document.json");
    expect(
      screen.queryByRole("group", { name: MESSAGES.modeGroup }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: MESSAGES.openSheet }),
    ).toBeNull();
  });
});
