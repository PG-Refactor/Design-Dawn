// Test doubles and fixtures shared by the application tests. Not imported by production
// code. The fake gateway keeps an in-memory file system and records every call in order.

import {
  type ContentPath,
  parseContentPath,
} from "../../domain/block/content-path";
import { type Document, parseDocument } from "../../domain/document/document";
import { type Folder, parseFolder } from "../../domain/folder/folder";
import { type Project, parseProject } from "../../domain/project/project";
import { parseDisplayName } from "../../domain/shared/display-name";
import {
  type BlockId,
  type DocumentId,
  type EntryId,
  type FolderId,
  parseDocumentId,
  parseFolderId,
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
import type { ClipboardBlock } from "../clipboard/clipboard";
import type { BlockSpec } from "../commands/command";
import type { DocumentData } from "../commands/document-data";
import { normalizeLineEndings } from "../commands/text-content";
import type { IdGenerator } from "../id-generator";
import type { ImportedImage, RejectedFile } from "../ports/asset-types";
import {
  type OperationErrorKind,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import {
  type DocumentSnapshot,
  type EntityState,
  type ExternalChanges,
  type FolderSelection,
  type LoadIssue,
  OPEN_IN_NEW_WINDOW_STATUS,
  type OpenInNewWindowResult,
  type OpenRequestResult,
  type ProjectSnapshot,
  type SheetSnapshot,
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

export function folderIdOf(counter: number): FolderId {
  return unwrap(
    parseFolderId(
      `01928f3a-2000-7000-8000-${counter.toString(16).padStart(12, "0")}`,
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
const GENERATED_FOLDER_ID_START = 0x4000;

export function createSequentialIdGenerator(start = 0x1000): IdGenerator {
  let nextBlock = start;
  let nextDocument = GENERATED_DOCUMENT_ID_START;
  let nextSheet = GENERATED_SHEET_ID_START;
  let nextFolder = GENERATED_FOLDER_ID_START;
  return {
    blockId: () => blockIdOf(nextBlock++),
    documentId: () => documentIdOf(nextDocument++),
    folderId: () => folderIdOf(nextFolder++),
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

// A Folder directory: its `folder.json` as last saved, and where it lives.
export interface FakeDiskFolder {
  folder: Folder;
  parentFolderId: FolderId | null;
  readonly state: EntityState;
}

export interface FakeDisk {
  projectName: string;
  // childOrder as last saved by `saveProject`.
  childOrder: EntryId[];
  readonly documents: Map<DocumentId, FakeDiskDocument>;
  // Folders at a basic level (create / save / move / delete with Rust's rules). A Document
  // missing from `documentParents` lives directly under the Project.
  readonly folders: Map<FolderId, FakeDiskFolder>;
  readonly documentParents: Map<DocumentId, FolderId>;
}

export interface SeedFolderOptions {
  readonly folderId: FolderId;
  readonly name?: string;
  readonly parentFolderId?: FolderId | null;
  readonly childOrder?: readonly EntryId[];
  // "loadFailed": the folder's own metadata cannot be loaded (it is never written).
  readonly state?: EntityState;
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

// An image file of a scripted drop. `initialWidth` / `initialHeight` default to the natural
// size (Rust's long-edge cap is not modelled).
export type FakeDroppedFile =
  | {
      readonly fileName: string;
      readonly naturalWidth: number;
      readonly naturalHeight: number;
      readonly initialWidth?: number;
      readonly initialHeight?: number;
    }
  | { readonly fileName: string; readonly rejectKind: OperationErrorKind };

export interface FakeAsset {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

const ASSET_DIRECTORY = "assets/";

export interface FakeGateway extends PersistenceGateway {
  readonly calls: RecordedCall[];
  // Persisted project / documents / sheets, to assert what is really "on disk".
  readonly disk: FakeDisk;
  // Adds a document that already exists on disk (and to the saved order).
  seedDocument(options: SeedDocumentOptions): void;
  // Adds a folder that already exists on disk (the saved orders are not changed).
  seedFolder(options: SeedFolderOptions): void;
  // Documents the gateway considers open (created or loaded and not yet closed). Folder
  // moves of an open Document are rejected, like Rust.
  readonly openDocuments: Set<DocumentId>;
  // The result of the next `selectProjectFolder` call (default: a selection).
  selectNext(selection: FolderSelection): void;
  // Makes `openProject(selectionId)` return exactly this snapshot instead of one built
  // from the disk (for a second project, or an invalid payload).
  overrideProjectSnapshot(selectionId: string, snapshot: ProjectSnapshot): void;
  // Makes the next `takeOpenRequest` return the project plus this document (a `.dawn`
  // launch argument); like Rust, it is handed out once.
  queueOpenRequest(documentId: DocumentId): void;
  // Like `queueOpenRequest`, for a Project folder: the project opens, no Document is named.
  queueProjectFolderRequest(): void;
  // The result of the next `openProjectInNewWindow` call (default: a new window).
  setOpenInNewWindowResult(result: OpenInNewWindowResult): void;
  // Session generation of the latest project snapshot handed out (each open / reload /
  // create is a new read, like a new Rust session).
  readonly sessionGeneration: () => number;
  // What the next `checkExternalChanges` calls return (until replaced); by default nothing
  // changed, reported for the current session generation.
  setExternalChanges(changes: ExternalChanges): void;
  // Document ids (null = Project level) `acceptDiskState` was called for, in order.
  readonly acceptedDiskStates: (DocumentId | null)[];
  // Method names in call order, optionally narrowed to some methods.
  methods(...only: readonly string[]): string[];
  // Content files that currently exist: contentPath -> text.
  readonly files: Map<string, string>;
  // Latest sheet / document handed to the save methods.
  readonly savedSheets: Map<string, Sheet>;
  savedDocumentNames: string[];
  // Asset files that exist, per Document: contentPath -> image.
  readonly assets: Map<DocumentId, Map<string, FakeAsset>>;
  // An asset that already exists in the Document (like one imported earlier).
  seedAsset(
    documentId: DocumentId,
    contentPath: string,
    image?: FakeAsset,
  ): ContentPath;
  hasAsset(documentId: DocumentId, contentPath: string): boolean;
  // What the next `importDroppedImages(dropId, ...)` finds (each script is used once, like
  // a drop in Rust).
  scriptDrop(dropId: string, files: readonly FakeDroppedFile[]): void;
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
  const assets = new Map<DocumentId, Map<string, FakeAsset>>();
  const drops = new Map<string, readonly FakeDroppedFile[]>();
  let nextSelection: FolderSelection = DEFAULT_SELECTION;
  const snapshotOverrides = new Map<string, ProjectSnapshot>();
  let pendingOpenRequest: DocumentId | "projectFolder" | null = null;
  let sessionGeneration = 0;
  let scriptedExternalChanges: ExternalChanges | null = null;
  const acceptedDiskStates: (DocumentId | null)[] = [];
  let openInNewWindowResult: OpenInNewWindowResult = {
    status: OPEN_IN_NEW_WINDOW_STATUS.openedInNewWindow,
  };
  const disk: FakeDisk = {
    projectName: "Project",
    childOrder: [],
    documents: new Map(),
    folders: new Map(),
    documentParents: new Map(),
  };
  const openDocuments = new Set<DocumentId>();

  function entryIdInUse(entryId: string): boolean {
    return (
      [...disk.folders.keys()].some((id) => id === entryId) ||
      [...disk.documents.keys()].some((id) => id === entryId)
    );
  }

  function parentOfEntry(entryId: EntryId): FolderId | null | undefined {
    const folder = disk.folders.get(entryId as FolderId);
    if (folder !== undefined) return folder.parentFolderId;
    const documentId = entryId as DocumentId;
    if (disk.documents.has(documentId)) {
      return disk.documentParents.get(documentId) ?? null;
    }
    return undefined;
  }

  // Whether `candidate` is `ancestor` or lies below it.
  function isAtOrBelow(candidate: FolderId, ancestor: FolderId): boolean {
    let current: FolderId | null = candidate;
    while (current !== null) {
      if (current === ancestor) return true;
      current = disk.folders.get(current)?.parentFolderId ?? null;
    }
    return false;
  }

  function hasChildren(folderId: FolderId): boolean {
    return (
      [...disk.folders.values()].some(
        (entry) => entry.parentFolderId === folderId,
      ) ||
      [...disk.documentParents.values()].some((parent) => parent === folderId)
    );
  }

  function newFolder(
    folderId: FolderId,
    name: string,
    childOrder: readonly EntryId[],
  ): Folder {
    return unwrap(
      parseFolder({ schemaVersion: 1, folderId, name, childOrder }),
    );
  }

  function projectOf(name: string, order: readonly EntryId[]): Project {
    return unwrap(
      parseProject({
        schemaVersion: 2,
        projectId: PROJECT_ID,
        name,
        childOrder: order,
      }),
    );
  }

  function projectSnapshot(): ProjectSnapshot {
    const rootDocuments = disk.childOrder.flatMap((entryId) => {
      const found = [...disk.documents.entries()].find(
        ([documentId]) => documentId === entryId,
      );
      if (found === undefined) return [];
      const [documentId, stored] = found;
      return [
        {
          documentId,
          parentFolderId: null,
          name: stored.state === "loaded" ? stored.document.name : null,
          state: stored.state,
        },
      ];
    });
    // Orders are reported as saved (not normalized); documents inside folders are all listed.
    const nestedDocuments = [...disk.documentParents.entries()].flatMap(
      ([documentId, parentFolderId]) => {
        const stored = disk.documents.get(documentId);
        if (stored === undefined) return [];
        return [
          {
            documentId,
            parentFolderId,
            name: stored.state === "loaded" ? stored.document.name : null,
            state: stored.state,
          },
        ];
      },
    );
    sessionGeneration += 1;
    return {
      project: projectOf(disk.projectName, disk.childOrder),
      sessionGeneration,
      folders: [...disk.folders.entries()].map(([folderId, entry]) => ({
        folderId,
        name: entry.state === "loaded" ? entry.folder.name : null,
        parentFolderId: entry.parentFolderId,
        childOrder: entry.state === "loaded" ? entry.folder.childOrder : [],
        state: entry.state,
      })),
      documents: [...rootDocuments, ...nestedDocuments],
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

  function assetsOf(documentId: DocumentId): Map<string, FakeAsset> {
    const existing = assets.get(documentId);
    if (existing !== undefined) return existing;
    const created = new Map<string, FakeAsset>();
    assets.set(documentId, created);
    return created;
  }

  // Like Rust: the name is kept; a collision gets `-2`, `-3`, ... before the extension.
  function freeAssetPath(documentId: DocumentId, fileName: string): string {
    const taken = assetsOf(documentId);
    const dot = fileName.lastIndexOf(".");
    const stem = dot < 0 ? fileName : fileName.slice(0, dot);
    const extension = dot < 0 ? "" : fileName.slice(dot);
    let candidate = `${ASSET_DIRECTORY}${fileName}`;
    for (let attempt = 2; taken.has(candidate); attempt += 1) {
      candidate = `${ASSET_DIRECTORY}${stem}-${attempt}${extension}`;
    }
    return candidate;
  }

  function baseName(contentPath: string): string {
    return contentPath.slice(contentPath.lastIndexOf("/") + 1);
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
      if (!disk.childOrder.includes(options.documentId)) {
        disk.childOrder.push(options.documentId);
      }
    },
    seedFolder(options) {
      const state = options.state ?? "loaded";
      disk.folders.set(options.folderId, {
        folder: newFolder(
          options.folderId,
          options.name ?? "Folder",
          options.childOrder ?? [],
        ),
        parentFolderId: options.parentFolderId ?? null,
        state,
      });
    },
    openDocuments,
    selectNext(selection) {
      nextSelection = selection;
    },
    overrideProjectSnapshot(selectionId, snapshot) {
      snapshotOverrides.set(selectionId, snapshot);
    },
    sessionGeneration: () => sessionGeneration,
    setExternalChanges(changes) {
      scriptedExternalChanges = changes;
    },
    acceptedDiskStates,
    queueOpenRequest(documentId) {
      pendingOpenRequest = documentId;
    },
    queueProjectFolderRequest() {
      pendingOpenRequest = "projectFolder";
    },
    setOpenInNewWindowResult(result) {
      openInNewWindowResult = result;
    },
    openProjectInNewWindow: (selectionId) =>
      enter("openProjectInNewWindow", selectionId, () =>
        operationOk(openInNewWindowResult),
      ),
    takeOpenRequest: () =>
      enter(
        "takeOpenRequest",
        "",
        (): OperationResult<OpenRequestResult | null> => {
          const pending = pendingOpenRequest;
          pendingOpenRequest = null;
          if (pending === null) return operationOk(null);
          if (pending === "projectFolder") {
            return operationOk({
              snapshot: projectSnapshot(),
              documentId: null,
              resolution: null,
            });
          }
          return operationOk({
            snapshot: projectSnapshot(),
            documentId: pending,
            resolution: "path" as const,
          });
        },
      ),
    closeProject: () => enter("closeProject", "", () => operationOk(undefined)),
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
    reloadProject: (projectId) =>
      enter("reloadProject", projectId, () => operationOk(projectSnapshot())),
    checkExternalChanges: (projectId) =>
      enter("checkExternalChanges", projectId, () =>
        operationOk(
          scriptedExternalChanges ?? {
            sessionGeneration,
            rescan: true,
            project: { structure: false, files: [] },
            documents: [],
          },
        ),
      ),
    acceptDiskState: (_projectId, documentId) =>
      enter("acceptDiskState", documentId ?? "project", () => {
        acceptedDiskStates.push(documentId);
        return operationOk(undefined);
      }),
    createProject: (selectionId, name) =>
      enter("createProject", `${selectionId}:${name}`, () => {
        if (selectionId !== DEFAULT_SELECTION_ID) {
          return operationErr("invalidFolderSelection", selectionId);
        }
        disk.projectName = name;
        disk.childOrder = [];
        disk.documents.clear();
        return operationOk(projectSnapshot());
      }),
    saveProject: (_project, project) =>
      enter("saveProject", project.childOrder.join(","), () => {
        disk.projectName = project.name;
        disk.childOrder = [...project.childOrder];
        return operationOk(undefined);
      }),
    createDocument: (_project, documentId, name, parentFolderId = null) =>
      enter("createDocument", documentId, () => {
        if (disk.documents.has(documentId)) {
          return operationErr("alreadyExists", documentId);
        }
        if (parentFolderId !== null) {
          const parent = disk.folders.get(parentFolderId);
          if (parent === undefined) {
            return operationErr("entityNotFound", parentFolderId);
          }
          if (parent.state !== "loaded") {
            return operationErr("notWritable", parentFolderId);
          }
          disk.documentParents.set(documentId, parentFolderId);
        }
        openDocuments.add(documentId);
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
    createFolder: (_project, parentFolderId, folderId, name) =>
      enter("createFolder", folderId, () => {
        if (entryIdInUse(folderId)) {
          return operationErr("duplicateId", folderId);
        }
        if (parentFolderId !== null) {
          const parent = disk.folders.get(parentFolderId);
          if (parent === undefined) {
            return operationErr("entityNotFound", parentFolderId);
          }
          if (parent.state !== "loaded") {
            return operationErr("notWritable", parentFolderId);
          }
        }
        // Like Rust: the directory exists now, the parent's order is the caller's job.
        disk.folders.set(folderId, {
          folder: newFolder(folderId, name, []),
          parentFolderId,
          state: "loaded",
        });
        return operationOk({
          folderId,
          name,
          parentFolderId,
          childOrder: [],
          state: "loaded" as const,
        });
      }),
    saveFolder: (_project, folder) =>
      enter("saveFolder", folder.folderId, () => {
        const stored = disk.folders.get(folder.folderId);
        if (stored === undefined) {
          return operationErr("entityNotFound", folder.folderId);
        }
        if (stored.state !== "loaded") {
          return operationErr("notWritable", folder.folderId);
        }
        stored.folder = folder;
        return operationOk(undefined);
      }),
    moveEntry: (_project, entryId, targetParentFolderId) =>
      enter(
        "moveEntry",
        `${entryId}->${targetParentFolderId ?? "root"}`,
        () => {
          const currentParent = parentOfEntry(entryId);
          if (currentParent === undefined) {
            return operationErr("entityNotFound", entryId);
          }
          const isFolder = disk.folders.has(entryId as FolderId);
          if (targetParentFolderId !== null) {
            const target = disk.folders.get(targetParentFolderId);
            if (target === undefined) {
              return operationErr("entityNotFound", targetParentFolderId);
            }
            if (target.state !== "loaded") {
              return operationErr("notWritable", targetParentFolderId);
            }
            if (
              isFolder &&
              isAtOrBelow(targetParentFolderId, entryId as FolderId)
            ) {
              return operationErr("invalidMove", entryId);
            }
          }
          if (currentParent === targetParentFolderId)
            return operationOk(undefined);
          // Like Rust: open documents move too (their session paths are rebased).
          if (isFolder) {
            const stored = disk.folders.get(entryId as FolderId);
            if (stored !== undefined)
              stored.parentFolderId = targetParentFolderId;
          } else if (targetParentFolderId === null) {
            disk.documentParents.delete(entryId as DocumentId);
          } else {
            disk.documentParents.set(
              entryId as DocumentId,
              targetParentFolderId,
            );
          }
          return operationOk(undefined);
        },
      ),
    deleteFolder: (_project, folderId) =>
      enter("deleteFolder", folderId, () => {
        if (!disk.folders.has(folderId)) {
          return operationErr("entityNotFound", folderId);
        }
        if (hasChildren(folderId)) {
          return operationErr("folderNotEmpty", folderId);
        }
        disk.folders.delete(folderId);
        return operationOk(undefined);
      }),
    loadDocument: (_project, documentId) =>
      enter("loadDocument", documentId, () => {
        const stored = disk.documents.get(documentId);
        if (stored === undefined) {
          return operationErr("entityNotFound", documentId);
        }
        if (stored.state !== "loaded") {
          return operationErr("invalidFileStructure", documentId);
        }
        openDocuments.add(documentId);
        return operationOk(documentSnapshot(stored));
      }),
    closeDocument: (_project, documentId) =>
      enter("closeDocument", documentId, () => {
        openDocuments.delete(documentId);
        return operationOk(undefined);
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
      enter("deleteDocument", documentId, () => {
        if (!disk.documents.delete(documentId)) {
          return operationErr("entityNotFound", documentId);
        }
        disk.documentParents.delete(documentId);
        openDocuments.delete(documentId);
        return operationOk(undefined);
      }),
    files,
    assets,
    seedAsset(
      documentId,
      contentPath,
      image = { naturalWidth: 100, naturalHeight: 50 },
    ) {
      assetsOf(documentId).set(contentPath, image);
      return unwrap(parseContentPath(contentPath));
    },
    hasAsset: (documentId, contentPath) =>
      assetsOf(documentId).has(contentPath),
    scriptDrop(dropId, files) {
      drops.set(dropId, files);
    },
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
    importDroppedImages: (dropId, _project, documentId) =>
      enter("importDroppedImages", `${dropId}:${documentId}`, () => {
        const files = drops.get(dropId);
        if (files === undefined) {
          return operationErr("invalidDropSelection", dropId);
        }
        drops.delete(dropId);
        const imported: ImportedImage[] = [];
        const rejected: RejectedFile[] = [];
        for (const file of files) {
          if ("rejectKind" in file) {
            rejected.push({
              fileName: file.fileName,
              error: {
                kind: file.rejectKind,
                detail: `injected: ${file.fileName}`,
              },
            });
            continue;
          }
          const path = freeAssetPath(documentId, file.fileName);
          assetsOf(documentId).set(path, {
            naturalWidth: file.naturalWidth,
            naturalHeight: file.naturalHeight,
          });
          imported.push({
            contentPath: unwrap(parseContentPath(path)),
            naturalWidth: file.naturalWidth,
            naturalHeight: file.naturalHeight,
            initialWidth: file.initialWidth ?? file.naturalWidth,
            initialHeight: file.initialHeight ?? file.naturalHeight,
            blockType: "image",
          });
        }
        return operationOk({ imported, rejected });
      }),
    copyAssetToDocument: (
      _project,
      sourceDocumentId,
      contentPath,
      targetDocumentId,
    ) =>
      enter(
        "copyAssetToDocument",
        `${sourceDocumentId}->${targetDocumentId}:${contentPath}`,
        () => {
          const source = assetsOf(sourceDocumentId).get(contentPath);
          if (source === undefined) {
            return operationErr("fileNotFound", contentPath);
          }
          // Same Document: the file is only validated, nothing is copied.
          if (sourceDocumentId === targetDocumentId) {
            return operationOk({ contentPath, ...source });
          }
          const path = freeAssetPath(targetDocumentId, baseName(contentPath));
          assetsOf(targetDocumentId).set(path, source);
          return operationOk({
            contentPath: unwrap(parseContentPath(path)),
            ...source,
          });
        },
      ),
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

// The text of a clipboard block or block spec, undefined for asset ones.
export function textOfBlockLike(
  value: ClipboardBlock | BlockSpec | undefined,
): string | undefined {
  return value !== undefined && "text" in value ? value.text : undefined;
}
