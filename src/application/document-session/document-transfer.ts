// The text a document travels in when it moves to another window. Each window is its own
// JavaScript world, so the session's hand-over (`DocumentSessionSeed`) goes through Rust as
// JSON. Rust stores it without reading it; the receiving window checks everything again
// (the same parsers as for the files), so only values the app could have made get in.

import {
  type Block,
  parseBlock,
  type RawBlock,
} from "../../domain/block/block";
import { parseCaption } from "../../domain/block/caption";
import {
  parseDocument,
  type RawDocument,
} from "../../domain/document/document";
import { parseDisplayName } from "../../domain/shared/display-name";
import type { DomainResult } from "../../domain/shared/domain-result";
import {
  type BlockId,
  type DocumentId,
  type ProjectId,
  parseBlockId,
  parseDocumentId,
  parseProjectId,
  parseSheetId,
  type SheetId,
} from "../../domain/shared/entity-id";
import { parsePosition, parseSize } from "../../domain/shared/geometry";
import {
  parseSheet,
  type RawSheet,
  type Sheet,
} from "../../domain/sheet/sheet";
import type { BlockFrame, BlockMove } from "../commands/block-commands";
import type { CapturedBlock } from "../commands/block-file-sequences";
import { COMMAND_KINDS } from "../commands/command-kind";
import {
  commandFromSnapshot,
  type MetadataCommandSnapshot,
} from "../commands/command-snapshot";
import type { HistoryEntry } from "../commands/history";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { DocumentSessionSeed } from "./document-session";

// Raised when the payload's shape changes; a window never takes in another version.
export const DOCUMENT_TRANSFER_VERSION = 1;

const REORDER_DIRECTIONS = [
  "forward",
  "backward",
  "toFront",
  "toBack",
] as const;

export interface DocumentTransfer {
  readonly projectId: ProjectId;
  // Which read of the Project the sender had (Rust's session generation). A document
  // from an older read must not be taken in.
  readonly sessionGeneration: number;
  readonly documentId: DocumentId;
  readonly seed: DocumentSessionSeed;
}

type HistoryEntryJson =
  | { readonly type: "metadata"; readonly command: MetadataCommandSnapshot }
  | Extract<HistoryEntry, { type: "fileBacked" }>;

interface DocumentTransferJson {
  readonly version: number;
  readonly projectId: string;
  readonly sessionGeneration: number;
  readonly documentId: string;
  readonly document: RawDocument;
  readonly sheets: readonly RawSheet[];
  readonly contents: readonly (readonly [string, string])[];
  readonly undo: readonly HistoryEntryJson[];
  readonly redo: readonly HistoryEntryJson[];
  readonly unsaved: {
    readonly documentChanged: boolean;
    readonly changedSheetIds: readonly string[];
    readonly changedContentBlockIds: readonly string[];
  };
}

function entryToJson(entry: HistoryEntry): HistoryEntryJson {
  return entry.type === "metadata"
    ? { type: "metadata", command: entry.command.snapshot() }
    : entry;
}

export function encodeDocumentTransfer(transfer: DocumentTransfer): string {
  const { seed } = transfer;
  const json: DocumentTransferJson = {
    version: DOCUMENT_TRANSFER_VERSION,
    projectId: transfer.projectId,
    sessionGeneration: transfer.sessionGeneration,
    documentId: transfer.documentId,
    document: seed.document,
    sheets: [...seed.sheets.values()],
    contents: [...seed.contents],
    undo: seed.undo.map(entryToJson),
    redo: seed.redo.map(entryToJson),
    unsaved: seed.unsaved,
  };
  return JSON.stringify(json);
}

// ---- decoding: every value is checked, the first problem stops it ----

class InvalidTransfer extends Error {}

function fail(detail: string): never {
  throw new InvalidTransfer(detail);
}

function valid<T>(result: DomainResult<T>, what: string): T {
  if (!result.ok) fail(`${what}: ${result.error.kind}`);
  return result.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${what} is not an object`);
  return value;
}

function list(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${what} is not a list`);
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") fail(`${what} is not a string`);
  return value;
}

function textOrNull(value: unknown, what: string): string | null {
  return value === null ? null : text(value, what);
}

function integer(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(`${what} is not an integer`);
  }
  return value;
}

function nullable<T>(value: unknown, read: (value: unknown) => T): T | null {
  return value === null ? null : read(value);
}

const sheetIdOf = (value: unknown, what = "sheetId"): SheetId =>
  valid(parseSheetId(text(value, what)), what);
const blockIdOf = (value: unknown, what = "blockId"): BlockId =>
  valid(parseBlockId(text(value, what)), what);
const nameOf = (value: unknown, what = "name") =>
  valid(parseDisplayName(text(value, what)), what);

function blockOf(value: unknown): Block {
  return valid(
    parseBlock(record(value, "block") as unknown as RawBlock),
    "block",
  );
}

function frameOf(value: unknown): BlockFrame {
  const frame = record(value, "frame");
  return {
    blockId: blockIdOf(frame.blockId),
    position: valid(
      parsePosition(record(frame.position, "position") as never),
      "position",
    ),
    size: valid(parseSize(record(frame.size, "size") as never), "size"),
  };
}

function moveOf(value: unknown): BlockMove {
  const move = record(value, "move");
  return {
    blockId: blockIdOf(move.blockId),
    position: valid(
      parsePosition(record(move.position, "position") as never),
      "position",
    ),
  };
}

function commandSnapshotOf(value: unknown): MetadataCommandSnapshot {
  const command = record(value, "command");
  switch (command.kind) {
    case COMMAND_KINDS.moveBlocks:
      return {
        kind: COMMAND_KINDS.moveBlocks,
        sheetId: sheetIdOf(command.sheetId),
        moves: list(command.moves, "moves").map(moveOf),
        previousFrames: nullable(command.previousFrames, (frames) =>
          list(frames, "previousFrames").map(frameOf),
        ),
      };
    case COMMAND_KINDS.resizeBlocks:
      return {
        kind: COMMAND_KINDS.resizeBlocks,
        sheetId: sheetIdOf(command.sheetId),
        frames: list(command.frames, "frames").map(frameOf),
        previousFrames: nullable(command.previousFrames, (frames) =>
          list(frames, "previousFrames").map(frameOf),
        ),
      };
    case COMMAND_KINDS.reorderBlocks: {
      const direction = REORDER_DIRECTIONS.find(
        (candidate) => candidate === command.direction,
      );
      if (direction === undefined) fail("unknown reorder direction");
      return {
        kind: COMMAND_KINDS.reorderBlocks,
        sheetId: sheetIdOf(command.sheetId),
        blockIds: list(command.blockIds, "blockIds").map((id) => blockIdOf(id)),
        direction,
        previousOrder: nullable(command.previousOrder, (order) =>
          list(order, "previousOrder").map((id) => blockIdOf(id)),
        ),
      };
    }
    case COMMAND_KINDS.renameSheet:
      return {
        kind: COMMAND_KINDS.renameSheet,
        sheetId: sheetIdOf(command.sheetId),
        name: nameOf(command.name),
        previousName: nullable(command.previousName, (name) => nameOf(name)),
      };
    case COMMAND_KINDS.renameDocument:
      return {
        kind: COMMAND_KINDS.renameDocument,
        name: nameOf(command.name),
        previousName: nullable(command.previousName, (name) => nameOf(name)),
      };
    case COMMAND_KINDS.moveSheet:
      return {
        kind: COMMAND_KINDS.moveSheet,
        sheetId: sheetIdOf(command.sheetId),
        beforeSheetId: nullable(command.beforeSheetId, (id) => sheetIdOf(id)),
        restoreBefore: nullable(command.restoreBefore, (restore) => ({
          sheetId: nullable(record(restore, "restoreBefore").sheetId, (id) =>
            sheetIdOf(id),
          ),
        })),
      };
    case COMMAND_KINDS.setBlockCaption: {
      const captionOf = (value: unknown) =>
        valid(parseCaption(text(value, "caption")), "caption");
      return {
        kind: COMMAND_KINDS.setBlockCaption,
        sheetId: sheetIdOf(command.sheetId),
        blockId: blockIdOf(command.blockId),
        caption: nullable(command.caption, captionOf),
        previous: nullable(command.previous, (previous) => ({
          caption: nullable(record(previous, "previous").caption, captionOf),
        })),
      };
    }
    case COMMAND_KINDS.editBlockContent:
      return {
        kind: COMMAND_KINDS.editBlockContent,
        sheetId: sheetIdOf(command.sheetId),
        blockId: blockIdOf(command.blockId),
        text: text(command.text, "text"),
        previousText: textOrNull(command.previousText, "previousText"),
      };
    default:
      return fail("unknown command kind");
  }
}

function capturedOf(value: unknown): CapturedBlock {
  const captured = record(value, "captured block");
  return {
    block: blockOf(captured.block),
    index: integer(captured.index, "index"),
    text: textOrNull(captured.text, "text"),
  };
}

function historyEntryOf(value: unknown): HistoryEntry {
  const entry = record(value, "history entry");
  if (entry.type === "metadata") {
    return {
      type: "metadata",
      command: commandFromSnapshot(commandSnapshotOf(entry.command)),
    };
  }
  if (entry.type !== "fileBacked") fail("unknown history entry type");
  if (
    entry.label !== COMMAND_KINDS.createBlocks &&
    entry.label !== COMMAND_KINDS.deleteBlocks
  ) {
    fail("unknown file-backed label");
  }
  if (typeof entry.present !== "boolean") fail("present is not a boolean");
  return {
    type: "fileBacked",
    label: entry.label,
    sheetId: sheetIdOf(entry.sheetId),
    blocks: list(entry.blocks, "blocks").map(capturedOf),
    present: entry.present,
  };
}

function decode(json: unknown): DocumentTransfer {
  const root = record(json, "transfer");
  if (root.version !== DOCUMENT_TRANSFER_VERSION) {
    fail(`version ${String(root.version)} is not ${DOCUMENT_TRANSFER_VERSION}`);
  }
  const documentId = valid(
    parseDocumentId(text(root.documentId, "documentId")),
    "documentId",
  );
  const document = valid(
    parseDocument(record(root.document, "document") as unknown as RawDocument),
    "document",
  );
  if (document.documentId !== documentId) fail("document id mismatch");
  const sheets = new Map<SheetId, Sheet>();
  for (const raw of list(root.sheets, "sheets")) {
    const sheet = valid(
      parseSheet(record(raw, "sheet") as unknown as RawSheet),
      "sheet",
    );
    sheets.set(sheet.sheetId, sheet);
  }
  const contents = new Map<BlockId, string>();
  for (const pair of list(root.contents, "contents")) {
    const [blockId, content] = list(pair, "content");
    contents.set(blockIdOf(blockId), text(content, "content"));
  }
  const unsaved = record(root.unsaved, "unsaved");
  if (typeof unsaved.documentChanged !== "boolean") {
    fail("documentChanged is not a boolean");
  }
  return {
    projectId: valid(
      parseProjectId(text(root.projectId, "projectId")),
      "projectId",
    ),
    sessionGeneration: integer(root.sessionGeneration, "sessionGeneration"),
    documentId,
    seed: {
      document,
      sheets,
      contents,
      undo: list(root.undo, "undo").map(historyEntryOf),
      redo: list(root.redo, "redo").map(historyEntryOf),
      unsaved: {
        documentChanged: unsaved.documentChanged,
        changedSheetIds: list(unsaved.changedSheetIds, "changedSheetIds").map(
          (id) => sheetIdOf(id),
        ),
        changedContentBlockIds: list(
          unsaved.changedContentBlockIds,
          "changedContentBlockIds",
        ).map((id) => blockIdOf(id)),
      },
    },
  };
}

export function decodeDocumentTransfer(
  payload: string,
): OperationResult<DocumentTransfer> {
  try {
    return operationOk(decode(JSON.parse(payload)));
  } catch (error) {
    const detail =
      error instanceof InvalidTransfer
        ? error.message
        : "the payload is not JSON";
    return operationErr("invalidDocumentTransfer", detail);
  }
}
