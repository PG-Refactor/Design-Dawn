// Test doubles and fixtures shared by the application tests. Not imported by production
// code. The fake gateway keeps an in-memory file system and records every call in order.

import { parseContentPath } from "../../domain/block/content-path";
import { type Document, parseDocument } from "../../domain/document/document";
import { type Project, parseProject } from "../../domain/project/project";
import { parseDisplayName } from "../../domain/shared/display-name";
import {
  type BlockId,
  type DocumentId,
  parseDocumentId,
  parseSheetId,
  type SheetId,
} from "../../domain/shared/entity-id";
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
import { parseSheet, type Sheet } from "../../domain/sheet/sheet";
import type { DocumentData } from "../commands/document-data";
import { normalizeLineEndings } from "../commands/text-content";
import type { IdGenerator } from "../id-generator";
import {
  type OperationErrorKind,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type {
  DocumentSnapshot,
  EntityState,
  FolderSelection,
  LoadIssue,
  ProjectSnapshot,
  SheetSnapshot,
} from "../ports/persistence-types";
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

export function documentIdOf(counter: number): DocumentId {
  return unwrap(
    parseDocumentId(
      `01928f3a-6c7d-7e8f-a012-${counter.toString(16).padStart(12, "0")}`,
    ),
  );
}

export function sheetIdOf(counter: number): SheetId {
  return unwrap(
    parseSheetId(
      `01928f3a-7d8e-7f90-b123-${counter.toString(16).padStart(12, "0")}`,
    ),
  );
}

// Generated documents / sheets get numbers far from the ones tests pick by hand.
const GENERATED_DOCUMENT_ID_START = 0x2000;
const GENERATED_SHEET_ID_START = 0x3000;

export function createSequentialIdGenerator(start = 0x1000): IdGenerator {
  let nextBlock = start;
  let nextDocument = GENERATED_DOCUMENT_ID_START;
  let nextSheet = GENERATED_SHEET_ID_START;
  return {
    blockId: () => blockIdOf(nextBlock++),
    documentId: () => documentIdOf(nextDocument++),
    sheetId: () => sheetIdOf(nextSheet++),
  };
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
    contents: new Map(),
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

// What the fake "disk" holds for a document: a persisted document (order as last saved)
// and the sheets whose directories exist.
export interface FakeDiskSheet {
  readonly name: string | null;
  readonly state: EntityState;
  readonly sheet: Sheet | null;
}

export interface FakeDiskDocument {
  document: Document;
  readonly state: EntityState;
  readonly sheets: Map<SheetId, FakeDiskSheet>;
  readonly issues: readonly LoadIssue[];
}

export interface FakeDisk {
  projectName: string;
  // documentOrder as last saved by `saveProject`.
  documentOrder: DocumentId[];
  readonly documents: Map<DocumentId, FakeDiskDocument>;
}

export interface SeedDocumentOptions {
  readonly documentId: DocumentId;
  readonly name?: string;
  // "loadFailed": the document's own metadata cannot be loaded.
  readonly state?: EntityState;
  readonly issues?: readonly LoadIssue[];
  readonly sheets?: readonly {
    readonly sheetId: SheetId;
    readonly name?: string;
    readonly state?: EntityState;
  }[];
}

const DEFAULT_SELECTION_ID = "selection-1";
const DEFAULT_SELECTION: FolderSelection = {
  status: "selected",
  selectionId: DEFAULT_SELECTION_ID,
  displayPath: "/projects/example",
};

export interface FakeGateway extends PersistenceGateway {
  readonly calls: RecordedCall[];
  // Persisted project / documents / sheets, to assert what is really "on disk".
  readonly disk: FakeDisk;
  // Adds a document that already exists on disk (and to the saved order).
  seedDocument(options: SeedDocumentOptions): void;
  // The result of the next `selectProjectFolder` call (default: a selection).
  selectNext(selection: FolderSelection): void;
  // Makes `openProject(selectionId)` return exactly this snapshot instead of one built
  // from the disk (for a second project, or an invalid payload).
  overrideProjectSnapshot(selectionId: string, snapshot: ProjectSnapshot): void;
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
  let nextSelection: FolderSelection = DEFAULT_SELECTION;
  const snapshotOverrides = new Map<string, ProjectSnapshot>();
  const disk: FakeDisk = {
    projectName: "Project",
    documentOrder: [],
    documents: new Map(),
  };

  function projectOf(name: string, order: readonly DocumentId[]): Project {
    return unwrap(
      parseProject({
        schemaVersion: 1,
        projectId: PROJECT_ID,
        name,
        documentOrder: order,
      }),
    );
  }

  function projectSnapshot(): ProjectSnapshot {
    return {
      project: projectOf(disk.projectName, disk.documentOrder),
      documents: disk.documentOrder.flatMap((documentId) => {
        const stored = disk.documents.get(documentId);
        return stored === undefined
          ? []
          : [
              {
                documentId,
                name: stored.state === "loaded" ? stored.document.name : null,
                state: stored.state,
              },
            ];
      }),
      issues: [],
    };
  }

  function documentSnapshot(stored: FakeDiskDocument): DocumentSnapshot {
    return {
      document: stored.document,
      sheets: [...stored.sheets.entries()].map(([sheetId, entry]) => ({
        sheetId,
        ...entry,
      })),
      issues: stored.issues,
    };
  }

  function newDocument(documentId: DocumentId, name: string): Document {
    return unwrap(
      parseDocument({
        schemaVersion: 1,
        documentId,
        name,
        sheetOrder: [],
      }),
    );
  }

  function newSheet(sheetId: SheetId, name: string): Sheet {
    return unwrap(parseSheet({ schemaVersion: 1, sheetId, name, blocks: [] }));
  }

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
    disk,
    seedDocument(options) {
      const state = options.state ?? "loaded";
      const sheets = new Map<SheetId, FakeDiskSheet>();
      for (const entry of options.sheets ?? []) {
        const sheetState = entry.state ?? "loaded";
        sheets.set(
          entry.sheetId,
          sheetState === "loaded"
            ? {
                name: entry.name ?? "Sheet",
                state: sheetState,
                sheet: newSheet(entry.sheetId, entry.name ?? "Sheet"),
              }
            : { name: null, state: sheetState, sheet: null },
        );
      }
      const document = unwrap(
        parseDocument({
          schemaVersion: 1,
          documentId: options.documentId,
          name: options.name ?? "Document",
          sheetOrder: [...sheets.keys()],
        }),
      );
      disk.documents.set(options.documentId, {
        document,
        state,
        sheets,
        issues: options.issues ?? [],
      });
      if (!disk.documentOrder.includes(options.documentId)) {
        disk.documentOrder.push(options.documentId);
      }
    },
    selectNext(selection) {
      nextSelection = selection;
    },
    overrideProjectSnapshot(selectionId, snapshot) {
      snapshotOverrides.set(selectionId, snapshot);
    },
    selectProjectFolder: () =>
      enter("selectProjectFolder", "", () => operationOk(nextSelection)),
    openProject: (selectionId) =>
      enter("openProject", selectionId, () => {
        const override = snapshotOverrides.get(selectionId);
        if (override !== undefined) return operationOk(override);
        return selectionId === DEFAULT_SELECTION_ID
          ? operationOk(projectSnapshot())
          : operationErr("invalidFolderSelection", selectionId);
      }),
    createProject: (selectionId, name) =>
      enter("createProject", `${selectionId}:${name}`, () => {
        if (selectionId !== DEFAULT_SELECTION_ID) {
          return operationErr("invalidFolderSelection", selectionId);
        }
        disk.projectName = name;
        disk.documentOrder = [];
        disk.documents.clear();
        return operationOk(projectSnapshot());
      }),
    saveProject: (_project, project) =>
      enter("saveProject", project.documentOrder.join(","), () => {
        disk.projectName = project.name;
        disk.documentOrder = [...project.documentOrder];
        return operationOk(undefined);
      }),
    createDocument: (_project, documentId, name) =>
      enter("createDocument", documentId, () => {
        if (disk.documents.has(documentId)) {
          return operationErr("alreadyExists", documentId);
        }
        const stored: FakeDiskDocument = {
          document: newDocument(documentId, name),
          state: "loaded",
          sheets: new Map(),
          issues: [],
        };
        // Like Rust: the directory exists now, the order file is the caller's job.
        disk.documents.set(documentId, stored);
        return operationOk(documentSnapshot(stored));
      }),
    loadDocument: (_project, documentId) =>
      enter("loadDocument", documentId, () => {
        const stored = disk.documents.get(documentId);
        if (stored === undefined) {
          return operationErr("entityNotFound", documentId);
        }
        return stored.state === "loaded"
          ? operationOk(documentSnapshot(stored))
          : operationErr("invalidFileStructure", documentId);
      }),
    createSheet: (_project, documentId, sheetId, name) =>
      enter("createSheet", sheetId, () => {
        const stored = disk.documents.get(documentId);
        if (stored === undefined) {
          return operationErr("entityNotFound", documentId);
        }
        const entry: FakeDiskSheet = {
          name,
          state: "loaded",
          sheet: newSheet(sheetId, name),
        };
        stored.sheets.set(sheetId, entry);
        const snapshot: SheetSnapshot = { sheetId, ...entry };
        return operationOk(snapshot);
      }),
    deleteSheet: (_project, documentId, sheetId) =>
      enter("deleteSheet", sheetId, () => {
        const deleted = disk.documents.get(documentId)?.sheets.delete(sheetId);
        return deleted === true
          ? operationOk(undefined)
          : operationErr("entityNotFound", sheetId);
      }),
    deleteDocument: (_project, documentId) =>
      enter("deleteDocument", documentId, () =>
        disk.documents.delete(documentId)
          ? operationOk(undefined)
          : operationErr("entityNotFound", documentId),
      ),
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
      enter("saveDocument", document.sheetOrder.join(","), () => {
        const stored = disk.documents.get(document.documentId);
        if (stored === undefined) {
          return operationErr("entityNotFound", document.documentId);
        }
        stored.document = document;
        gateway.savedDocumentNames.push(document.name);
        return operationOk(undefined);
      }),
    createBlockContent: (_project, _document, _sheet, blockType, text) =>
      enter("createBlockContent", blockType, () => {
        fileCounter += 1;
        const path = unwrap(
          parseContentPath(`sheets/s/blocks/${blockType}-c${fileCounter}.md`),
        );
        files.set(path, normalizeLineEndings(text));
        return operationOk(path);
      }),
    readBlockContent: (_project, _document, contentPath) =>
      enter("readBlockContent", contentPath, () => {
        const text = files.get(contentPath);
        return text === undefined
          ? operationErr("fileNotFound", contentPath)
          : operationOk(text);
      }),
    writeBlockContent: (_project, _document, contentPath, text) =>
      enter("writeBlockContent", contentPath, () => {
        // Like Rust: saving never creates content, and CRLF is normalized on write.
        if (!files.has(contentPath)) {
          return operationErr("fileNotFound", contentPath);
        }
        files.set(contentPath, normalizeLineEndings(text));
        return operationOk(undefined);
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
        files.set(contentPath, normalizeLineEndings(text));
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
