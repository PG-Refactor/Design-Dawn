// Test doubles and fixtures shared by the application tests. Not imported by production
// code. The fake gateway keeps an in-memory file system and records every call in order.

import { parseContentPath } from "../../domain/block/content-path";
import { parseDocument } from "../../domain/document/document";
import { parseDisplayName } from "../../domain/shared/display-name";
import type { BlockId } from "../../domain/shared/entity-id";
import { parsePosition, parseSize } from "../../domain/shared/geometry";
// Domain fixtures: ids and blocks / sheets with predictable content (Domain tests use them
// too, so they live in the domain test support).
import {
  blockIdOf,
  DOCUMENT_ID,
  makeBlockAt,
  makeSheetWith,
  OTHER_SHEET_ID,
  PROJECT_ID,
  SHEET_ID,
} from "../../domain/shared/test-fixtures";
import { unwrap } from "../../domain/shared/test-support";
import type { Sheet } from "../../domain/sheet/sheet";
import type { DocumentData } from "../commands/document-data";
import type { IdGenerator } from "../id-generator";
import {
  type OperationErrorKind,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { Scheduler } from "../ports/scheduler";

export {
  blockIdOf,
  DOCUMENT_ID,
  makeBlockAt,
  makeSheetWith,
  OTHER_SHEET_ID,
  PROJECT_ID,
  SHEET_ID,
};

export function createSequentialIdGenerator(start = 0x1000): IdGenerator {
  let next = start;
  return { blockId: () => blockIdOf(next++) };
}

export function makeDocumentData(
  blocks: readonly ReturnType<typeof makeBlockAt>[] = [],
): DocumentData {
  const sheet = makeSheetWith(SHEET_ID, blocks);
  const otherSheet = makeSheetWith(OTHER_SHEET_ID, []);
  const document = unwrap(
    parseDocument({
      schemaVersion: 1,
      documentId: DOCUMENT_ID,
      name: "Document",
      sheetOrder: [SHEET_ID, OTHER_SHEET_ID],
    }),
  );
  return {
    document,
    sheets: new Map([
      [sheet.sheetId, sheet],
      [otherSheet.sheetId, otherSheet],
    ]),
  };
}

export function displayName(value: string) {
  return unwrap(parseDisplayName(value));
}

export function position(x: number, y: number) {
  return unwrap(parsePosition({ x, y }));
}

export function size(width: number, height: number) {
  return unwrap(parseSize({ width, height }));
}

export interface RecordedCall {
  readonly method: string;
  readonly detail: string;
}

export interface FakeGateway extends PersistenceGateway {
  readonly calls: RecordedCall[];
  // Method names in call order, optionally narrowed to some methods.
  methods(...only: readonly string[]): string[];
  // Content files that currently exist: contentPath -> text.
  readonly files: Map<string, string>;
  // Latest sheet / document handed to the save methods.
  readonly savedSheets: Map<string, Sheet>;
  savedDocumentNames: string[];
  // Fails the `occurrence`-th call (1-based, counted from now) of `method`, once.
  failOn(method: string, kind: OperationErrorKind, occurrence?: number): void;
  failAlways(method: string, kind: OperationErrorKind): void;
  clearFailures(): void;
  // Suspends the next call of `method` until the returned function is called.
  hold(method: string): () => void;
  clearCalls(): void;
}

export function createFakeGateway(
  initialFiles: Readonly<Record<string, string>> = {},
): FakeGateway {
  const calls: RecordedCall[] = [];
  const files = new Map(Object.entries(initialFiles));
  const savedSheets = new Map<string, Sheet>();
  const counts = new Map<string, number>();
  const failures = new Map<string, Map<number, OperationErrorKind>>();
  const permanentFailures = new Map<string, OperationErrorKind>();
  const holds = new Map<string, Promise<void>>();
  let fileCounter = 0;

  async function enter<T>(
    method: string,
    detail: string,
    run: () => OperationResult<T>,
  ): Promise<OperationResult<T>> {
    calls.push({ method, detail });
    const count = (counts.get(method) ?? 0) + 1;
    counts.set(method, count);
    const hold = holds.get(method);
    if (hold !== undefined) {
      holds.delete(method);
      await hold;
    }
    const kind =
      failures.get(method)?.get(count) ?? permanentFailures.get(method);
    if (kind !== undefined) return operationErr(kind, `injected: ${method}`);
    return run();
  }

  const gateway: FakeGateway = {
    calls,
    files,
    savedSheets,
    savedDocumentNames: [],
    methods: (...only) =>
      calls
        .map((call) => call.method)
        .filter((method) => only.length === 0 || only.includes(method)),
    failOn(method, kind, occurrence = 1) {
      const forMethod = failures.get(method) ?? new Map();
      forMethod.set((counts.get(method) ?? 0) + occurrence, kind);
      failures.set(method, forMethod);
    },
    failAlways: (method, kind) => permanentFailures.set(method, kind),
    clearFailures() {
      failures.clear();
      permanentFailures.clear();
    },
    hold(method) {
      let release: () => void = () => undefined;
      holds.set(
        method,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return release;
    },
    clearCalls() {
      calls.length = 0;
    },
    saveSheet: (_project, _document, sheet) =>
      enter("saveSheet", sheet.sheetId, () => {
        savedSheets.set(sheet.sheetId, sheet);
        return operationOk(undefined);
      }),
    saveDocument: (_project, document) =>
      enter("saveDocument", document.name, () => {
        gateway.savedDocumentNames.push(document.name);
        return operationOk(undefined);
      }),
    createBlockContent: (_project, _document, _sheet, blockType, text) =>
      enter("createBlockContent", blockType, () => {
        fileCounter += 1;
        const path = unwrap(
          parseContentPath(`sheets/s/blocks/${blockType}-c${fileCounter}.md`),
        );
        files.set(path, text);
        return operationOk(path);
      }),
    readBlockContent: (_project, _document, contentPath) =>
      enter("readBlockContent", contentPath, () => {
        const text = files.get(contentPath);
        return text === undefined
          ? operationErr("fileNotFound", contentPath)
          : operationOk(text);
      }),
    deleteBlockContent: (_project, _document, contentPath) =>
      enter("deleteBlockContent", contentPath, () => {
        files.delete(contentPath);
        return operationOk(undefined);
      }),
    restoreBlockContent: (_project, _document, _type, contentPath, text) =>
      enter("restoreBlockContent", contentPath, () => {
        if (files.has(contentPath)) {
          return operationErr("alreadyExists", contentPath);
        }
        files.set(contentPath, text);
        return operationOk(undefined);
      }),
  };
  return gateway;
}

export interface FakeScheduler extends Scheduler {
  // Timers that are scheduled and not yet run or cancelled.
  pendingCount(): number;
  // Moves the clock forward and runs every timer that became due, in order.
  advance(ms: number): void;
}

export function createFakeScheduler(): FakeScheduler {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { dueAt: number; callback: () => void }>();
  return {
    schedule(delayMs, callback) {
      const id = nextId++;
      timers.set(id, { dueAt: now + delayMs, callback });
      return () => {
        timers.delete(id);
      };
    },
    pendingCount: () => timers.size,
    advance(ms) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort(([, first], [, second]) => first.dueAt - second.dueAt);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

// Lets already-resolved promise chains (fake gateway, serial queue) finish.
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Initial files for blocks built with `makeBlockAt`: text is derived from the id.
export function filesForBlocks(
  blocks: readonly ReturnType<typeof makeBlockAt>[],
): Record<string, string> {
  return Object.fromEntries(
    blocks.map((block) => [block.contentPath, textOf(block.blockId)]),
  );
}

export function textOf(blockId: BlockId): string {
  return `text of ${blockId}`;
}
