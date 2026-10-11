import { describe, expect, it } from "vitest";
import { editBlockContentCommand } from "../../application/commands/content-commands";
import { makeBlockAt, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import {
  createActionsHarness,
  seedSheetBlocks,
} from "../workspace/test-support/actions-harness";
import { runGitPull } from "./git-remote-flow";

// The pull reload (git-remote-flow.test.ts) with a Mermaid source: a unsaved edit is saved
// before the pull, and the text the pull brought in is what the reopened Document holds.

const MERMAID = makeBlockAt(1, 0, 0, "mermaid");
const LOCAL = "flowchart LR\n  A --> B";
const PULLED = "flowchart LR\n  A --> B\n  B --> C";
const OLD_OID = "a".repeat(40);
const NEW_OID = "b".repeat(40);

describe("runGitPull with a Mermaid block", () => {
  it("saves the local edit before pulling and reopens the Document with the pulled source", async () => {
    const harness = createActionsHarness();
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, [MERMAID]);
    const opened = await harness.actions.openProjectViaDialog();
    expect(opened.ok).toBe(true);
    await harness.actions.openDocument(DOCUMENT_A);
    const session = harness.workspace.getDocumentSession(DOCUMENT_A);
    if (session === null) throw new Error("document A must be open");
    await session.loadSheetContents(SHEET_A1);
    await session.execute(
      editBlockContentCommand({
        sheetId: SHEET_A1,
        blockId: MERMAID.blockId,
        text: LOCAL,
      }),
    );
    const branch = (oid: string) => ({
      head: "main",
      oid,
      upstream: "origin/main",
      ahead: 0,
      behind: 1,
      headPushed: false,
    });
    harness.gitGateway.status = {
      repositoryState: "ready",
      branch: branch(OLD_OID),
      files: [],
    };
    await harness.gitController.refreshGitStatus();
    harness.gitGateway.pullResult = {
      status: {
        outcome: "updated",
        status: {
          repositoryState: "ready",
          branch: branch(NEW_OID),
          files: [],
        },
      },
    };
    const release = harness.gitGateway.holdNextRemote();
    const pending = runGitPull(harness.services);
    await settle();
    // Held inside git: the local edit is on the disk now; the pull then rewrites the file.
    expect(harness.gateway.files.get(MERMAID.contentPath)).toBe(LOCAL);
    harness.gateway.files.set(MERMAID.contentPath, PULLED);
    release();
    expect(await pending).toBe("done");

    const reopened = harness.workspace.getDocumentSession(DOCUMENT_A);
    if (reopened === null) throw new Error("document A must be reopened");
    await reopened.loadSheetContents(SHEET_A1);
    expect(reopened.getState().contents.get(MERMAID.blockId)).toBe(PULLED);
    expect(reopened.getState().history.canUndo).toBe(false);
    expect(harness.gateway.files.get(MERMAID.contentPath)).toBe(PULLED);
  });
});
