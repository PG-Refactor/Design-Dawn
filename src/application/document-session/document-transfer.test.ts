import { describe, expect, it } from "vitest";
import { parseCaption } from "../../domain/block/caption";
import { blockDisplayOf } from "../../domain/block/content-scale";
import { unwrap } from "../../domain/shared/test-support";
import {
  moveBlocksCommand,
  reorderBlocksCommand,
  resizeBlocksCommand,
  setBlockCaptionCommand,
  setBlockDisplayCommand,
} from "../commands/block-commands";
import { editBlockContentCommand } from "../commands/content-commands";
import {
  createBlocksCommand,
  deleteBlocksCommand,
} from "../commands/file-backed-commands";
import {
  moveSheetCommand,
  renameDocumentCommand,
} from "../commands/naming-commands";
import type { DocumentSessionState } from "../state/application-state";
import {
  blockIdOf,
  DOCUMENT_ID,
  displayName,
  OTHER_SHEET_ID,
  PROJECT_ID,
  position,
  SHEET_ID,
  size,
  textOf,
} from "../test-support/fakes";
import {
  openSession,
  type SessionHarness,
  TEST_AUTO_SAVE_DELAY_MS,
} from "../test-support/session-harness";
import {
  createDocumentSession,
  type DocumentSession,
} from "./document-session";
import {
  DOCUMENT_TRANSFER_VERSION,
  decodeDocumentTransfer,
  encodeDocumentTransfer,
} from "./document-transfer";

const FIRST = blockIdOf(1);
const NEW_BLOCK = blockIdOf(10);
const GENERATION = 3;

// A session with unsaved work of every kind: a moved block, an edited text, a renamed
// document (all only in memory) and a created block (already on disk, file-backed).
async function editedSession(): Promise<SessionHarness> {
  const harness = openSession(
    undefined,
    {},
    { isEnabled: () => false, subscribe: () => () => undefined },
  );
  const { session } = harness;
  await session.loadSheetContents(SHEET_ID);
  await session.execute(
    createBlocksCommand(SHEET_ID, [
      {
        blockId: NEW_BLOCK,
        blockType: "markdown",
        position: position(400, 400),
        size: size(100, 80),
        text: "created",
      },
    ]),
  );
  await session.execute(
    moveBlocksCommand(SHEET_ID, [
      { blockId: FIRST, position: position(55, 66) },
    ]),
  );
  await session.execute(
    editBlockContentCommand({
      sheetId: SHEET_ID,
      blockId: FIRST,
      text: "edited",
    }),
  );
  await session.execute(renameDocumentCommand(displayName("Renamed")));
  harness.gateway.clearCalls();
  return harness;
}

// The receiving window: a new session from the decoded seed, on the same files.
function receive(harness: SessionHarness, payload: string) {
  const decoded = decodeDocumentTransfer(payload);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
  const states: DocumentSessionState[] = [];
  const { seed } = decoded.value;
  const session: DocumentSession = createDocumentSession({
    projectId: decoded.value.projectId,
    document: seed.document,
    sheets: seed.sheets,
    seed,
    gateway: harness.gateway,
    scheduler: harness.scheduler,
    config: { undoHistoryLimit: 50, autoSaveDelayMs: TEST_AUTO_SAVE_DELAY_MS },
    onStateChange: (state) => states.push(state),
  });
  return { session, transfer: decoded.value };
}

async function handOver(harness: SessionHarness): Promise<string> {
  const handed = await harness.session.handOver();
  if (!handed.ok) throw new Error(JSON.stringify(handed.error));
  return encodeDocumentTransfer({
    projectId: PROJECT_ID,
    sessionGeneration: GENERATION,
    documentId: DOCUMENT_ID,
    seed: handed.value,
  });
}

const firstBlock = (session: DocumentSession) =>
  session
    .getState()
    .sheets.get(SHEET_ID)
    ?.blocks.find((block) => block.blockId === FIRST);

describe("moving a document to another window", () => {
  it("hands over without saving, and the old session is closed", async () => {
    const harness = await editedSession();
    const before = harness.session.getState();
    await handOver(harness);
    expect(harness.gateway.methods()).toEqual([]);
    expect((await harness.session.undo()).ok).toBe(false);
    expect(before.save.documentDirty).toBe(true);
  });

  it("arrives with the same values, unsaved marks and history", async () => {
    const harness = await editedSession();
    const before = harness.session.getState();
    const { session, transfer } = receive(harness, await handOver(harness));
    expect(transfer.sessionGeneration).toBe(GENERATION);
    const after = session.getState();
    expect(after.document).toEqual(before.document);
    expect([...after.sheets]).toEqual([...before.sheets]);
    expect([...after.contents]).toEqual([...before.contents]);
    expect(after.save.documentDirty).toBe(true);
    expect([...after.save.dirtySheetIds]).toEqual([
      ...before.save.dirtySheetIds,
    ]);
    expect([...after.save.dirtyContentBlockIds]).toEqual([
      ...before.save.dirtyContentBlockIds,
    ]);
    expect(after.history).toEqual(before.history);
  });

  it("undoes and redoes there, through every kind of entry", async () => {
    const harness = await editedSession();
    const { session } = receive(harness, await handOver(harness));
    await session.undo();
    expect(session.getState().document.name).toBe(displayName("Document"));
    await session.undo();
    expect(session.getState().contents.get(FIRST)).toBe(textOf(FIRST));
    await session.undo();
    expect(firstBlock(session)?.position).toEqual(position(0, 0));
    // The file-backed entry removes the created block (and its file) again.
    await session.undo();
    expect(session.getState().contents.has(NEW_BLOCK)).toBe(false);
    await session.redo();
    expect(session.getState().contents.get(NEW_BLOCK)).toBe("created");
    await session.redo();
    expect(firstBlock(session)?.position).toEqual(position(55, 66));
  });

  it("saves the unsaved changes from there", async () => {
    const harness = await editedSession();
    const { session } = receive(harness, await handOver(harness));
    expect((await session.flush()).ok).toBe(true);
    expect(session.getState().save.documentDirty).toBe(false);
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
    const path =
      session
        .getState()
        .sheets.get(SHEET_ID)
        ?.blocks.find((b) => b.blockId === FIRST)?.contentPath ?? "";
    expect(harness.gateway.files.get(path)).toBe("edited");
  });

  it("refuses a payload of another version or with invalid values", () => {
    const valid = JSON.stringify({ version: DOCUMENT_TRANSFER_VERSION });
    for (const payload of [
      "not json",
      JSON.stringify({ version: DOCUMENT_TRANSFER_VERSION + 1 }),
      valid,
    ]) {
      const decoded = decodeDocumentTransfer(payload);
      expect(!decoded.ok && decoded.error.kind).toBe("invalidDocumentTransfer");
    }
  });

  it("carries a sheet deletion planned for the next save", async () => {
    const harness = await editedSession();
    await harness.session.runExclusive(async (scope) => {
      scope.planSheetRemoval(OTHER_SHEET_ID);
      return { ok: true, value: undefined };
    });

    const { session } = receive(harness, await handOver(harness));
    const handedOnward = await session.handOver();

    expect(
      handedOnward.ok && handedOnward.value.plannedFiles.sheetDeletes,
    ).toEqual([OTHER_SHEET_ID]);
  });

  it("refuses a history entry it does not know", async () => {
    const harness = await editedSession();
    const payload = JSON.parse(await handOver(harness));
    payload.undo[0] = { type: "metadata", command: { kind: "formatDisk" } };
    const decoded = decodeDocumentTransfer(JSON.stringify(payload));
    expect(!decoded.ok && decoded.error.kind).toBe("invalidDocumentTransfer");
  });

  // File paths are Rust's to check (every file operation does); the values the Domain
  // parsers own are checked here.
  it("refuses a block the Domain would not accept", async () => {
    const harness = await editedSession();
    const payload = JSON.parse(await handOver(harness));
    payload.sheets[0].blocks[0].blockId = "not-an-id";
    const decoded = decodeDocumentTransfer(JSON.stringify(payload));
    expect(!decoded.ok && decoded.error.kind).toBe("invalidDocumentTransfer");
  });
});

describe("transferring every kind of history entry", () => {
  async function richSession(): Promise<SessionHarness> {
    const harness = await editedSession();
    const { session } = harness;
    const commands = [
      resizeBlocksCommand(SHEET_ID, [
        { blockId: FIRST, position: position(55, 66), size: size(120, 90) },
      ]),
      reorderBlocksCommand(SHEET_ID, [FIRST], "toFront"),
      moveSheetCommand(SHEET_ID, null),
      setBlockCaptionCommand(SHEET_ID, FIRST, {
        text: unwrap(parseCaption("Figure")),
        position: "below",
      }),
      setBlockCaptionCommand(SHEET_ID, FIRST, null),
      setBlockDisplayCommand(SHEET_ID, FIRST, {
        ...blockDisplayOf({ blockType: "markdown" }),
        autoFit: true,
      }),
      deleteBlocksCommand(SHEET_ID, [blockIdOf(2)]),
    ];
    for (const command of commands) {
      const executed = await session.execute(command);
      if (!executed.ok) throw new Error(JSON.stringify(executed.error));
    }
    return harness;
  }

  it("arrives with the same history and undoes all of it there", async () => {
    const harness = await richSession();
    const before = harness.session.getState();
    const { session } = receive(harness, await handOver(harness));
    expect(session.getState().history).toEqual(before.history);
    for (let step = 0; step < 11; step += 1) {
      expect((await session.undo()).ok).toBe(true);
    }
  });

  it("takes in a block without text and a sheet moved in front of another", async () => {
    const harness = await richSession();
    const payload = JSON.parse(await handOver(harness));
    const fileBacked = (
      payload.undo as { type: string; blocks?: { text: string | null }[] }[]
    ).find((entry) => entry.type === "fileBacked");
    const captured = fileBacked?.blocks?.[0];
    if (captured === undefined) throw new Error("no file-backed entry");
    captured.text = null;
    mutateCommand(payload, "moveSheet", (command) => {
      command.beforeSheetId = OTHER_SHEET_ID;
    });
    expect(decodeDocumentTransfer(JSON.stringify(payload)).ok).toBe(true);
  });

  it.each<[string, (payload: Record<string, unknown>) => void]>([
    [
      "a payload that is not an object",
      (payload) => {
        for (const key of Object.keys(payload)) delete payload[key];
        payload.version = null;
      },
    ],
    [
      "a history that is not a list",
      (payload) => {
        payload.undo = 1;
      },
    ],
    [
      "a project id that is not a string",
      (payload) => {
        payload.projectId = 5;
      },
    ],
    [
      "a generation that is not an integer",
      (payload) => {
        payload.sessionGeneration = 1.5;
      },
    ],
    [
      "another document than the one named",
      (payload) => {
        payload.documentId = "01928f3a-6c7d-7e8f-a012-3456789abc00";
      },
    ],
    [
      "an unknown entry type",
      (payload) => {
        (payload.undo as unknown[])[0] = { type: "other" };
      },
    ],
    [
      "an unknown file-backed label",
      (payload) => {
        (payload.undo as unknown[])[0] = { type: "fileBacked", label: "other" };
      },
    ],
    [
      "a file-backed entry without a presence",
      (payload) => {
        (payload.undo as unknown[])[0] = {
          type: "fileBacked",
          label: "createBlocks",
          present: "yes",
        };
      },
    ],
    [
      "an unsaved mark that is not a boolean",
      (payload) => {
        (payload.unsaved as Record<string, unknown>).documentChanged = "yes";
      },
    ],
    [
      "an unknown reorder direction",
      (payload) => {
        mutateCommand(payload, "reorderBlocks", (command) => {
          command.direction = "sideways";
        });
      },
    ],
    [
      "an auto-fit that is not a boolean",
      (payload) => {
        mutateCommand(payload, "setBlockDisplay", (command) => {
          (command.display as Record<string, unknown>).autoFit = "yes";
        });
      },
    ],
    [
      "a scale that is not a number",
      (payload) => {
        mutateCommand(payload, "setBlockDisplay", (command) => {
          (command.display as Record<string, unknown>).scalePercent = "big";
        });
      },
    ],
  ])("refuses %s", async (_what, corrupt) => {
    const harness = await richSession();
    const payload = JSON.parse(await handOver(harness));
    corrupt(payload);
    const decoded = decodeDocumentTransfer(
      Object.keys(payload).length === 1 ? "null" : JSON.stringify(payload),
    );
    expect(!decoded.ok && decoded.error.kind).toBe("invalidDocumentTransfer");
  });
});

function mutateCommand(
  payload: Record<string, unknown>,
  kind: string,
  change: (command: Record<string, unknown>) => void,
): void {
  const entry = (
    payload.undo as { type: string; command?: Record<string, unknown> }[]
  ).find((candidate) => candidate.command?.kind === kind);
  if (entry?.command === undefined) throw new Error(`no ${kind} entry`);
  change(entry.command);
}
