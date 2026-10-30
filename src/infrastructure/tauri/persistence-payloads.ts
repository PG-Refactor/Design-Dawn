// Converts untyped command payloads into typed values. Shapes are checked first, then the
// existing domain parsers run, so TypeScript validates everything Rust returns as well.

import type { RawBlock } from "../../domain/block/block";
import { parseContentPath } from "../../domain/block/content-path";
import {
  type Document,
  parseDocument,
  type RawDocument,
} from "../../domain/document/document";
import { parseProject, type RawProject } from "../../domain/project/project";
import type { DomainResult } from "../../domain/shared/domain-result";
import {
  type EntryId,
  type FolderId,
  parseDocumentId,
  parseEntryId,
  parseFolderId,
  parseSheetId,
} from "../../domain/shared/entity-id";
import type { RawPosition, RawSize } from "../../domain/shared/geometry";
import {
  parseSheet,
  type RawSheet,
  type Sheet,
} from "../../domain/sheet/sheet";
import {
  BLOCK_COMPARISON_OUTCOMES,
  ENTITY_STATES,
  ENTRY_POINT_RESOLUTIONS,
  type EntityState,
  FILE_CHANGE_KINDS,
  FOLDER_SELECTION_STATUS,
  LOAD_ISSUE_KINDS,
  OPEN_IN_NEW_WINDOW_STATUS,
  REPAIR_UNAVAILABLE_REASONS,
} from "./command-constants";
import { type CommandResult, commandErr, commandOk } from "./command-error";
import {
  arrayOf,
  type Decoded,
  type Decoder,
  decodeBoolean,
  decodeNumber,
  decodeString,
  nullable,
  objectOf,
  oneOf,
} from "./payload-decoder";
import type {
  BlockContentComparison,
  ChangedFile,
  DocumentEntry,
  DocumentSnapshot,
  ExternalChanges,
  FolderEntry,
  FolderSelection,
  FolderSnapshot,
  FormatUpdateResult,
  LoadIssue,
  OpenInNewWindowResult,
  OpenRequestResult,
  ProjectSnapshot,
  RepairOutcome,
  SaveResult,
  SheetSnapshot,
} from "./persistence-types";

const PAYLOAD_ROOT = "payload";

type FolderSelectionStatus =
  (typeof FOLDER_SELECTION_STATUS)[keyof typeof FOLDER_SELECTION_STATUS];

const rawPosition = objectOf<RawPosition>({ x: decodeNumber, y: decodeNumber });
const rawSize = objectOf<RawSize>({
  width: decodeNumber,
  height: decodeNumber,
});
const rawBlock = objectOf<RawBlock>({
  blockId: decodeString,
  blockType: decodeString,
  position: rawPosition,
  size: rawSize,
  contentPath: decodeString,
});
const rawProject = objectOf<RawProject>({
  schemaVersion: decodeNumber,
  projectId: decodeString,
  name: decodeString,
  childOrder: arrayOf(decodeString),
});
const rawDocument = objectOf<RawDocument>({
  schemaVersion: decodeNumber,
  documentId: decodeString,
  name: decodeString,
  sheetOrder: arrayOf(decodeString),
});
const rawSheet = objectOf<RawSheet>({
  schemaVersion: decodeNumber,
  sheetId: decodeString,
  name: decodeString,
  blocks: arrayOf(rawBlock),
});

const decodeEntityState = oneOf(ENTITY_STATES);
const decodeLoadIssue = objectOf<LoadIssue>({
  kind: oneOf(LOAD_ISSUE_KINDS),
  path: nullable(decodeString),
  entityId: nullable(decodeString),
  detail: decodeString,
  reason: nullable(decodeString),
});

interface RawDocumentEntry {
  readonly documentId: string;
  readonly parentFolderId: string | null;
  readonly name: string | null;
  readonly state: EntityState;
}
interface RawFolderEntry {
  readonly folderId: string;
  readonly name: string | null;
  readonly parentFolderId: string | null;
  readonly childOrder: readonly string[];
  readonly state: EntityState;
}
interface RawProjectSnapshot {
  readonly project: RawProject;
  readonly sessionGeneration: number;
  readonly folders: readonly RawFolderEntry[];
  readonly documents: readonly RawDocumentEntry[];
  readonly issues: readonly LoadIssue[];
}
interface RawSheetSnapshot {
  readonly sheetId: string;
  readonly name: string | null;
  readonly state: EntityState;
  readonly sheet: RawSheet | null;
}
interface RawDocumentSnapshot {
  readonly document: RawDocument;
  readonly sheets: readonly RawSheetSnapshot[];
  readonly issues: readonly LoadIssue[];
}

const rawFolderEntry = objectOf<RawFolderEntry>({
  folderId: decodeString,
  name: nullable(decodeString),
  parentFolderId: nullable(decodeString),
  childOrder: arrayOf(decodeString),
  state: decodeEntityState,
});
const rawProjectSnapshot = objectOf<RawProjectSnapshot>({
  project: rawProject,
  sessionGeneration: decodeNumber,
  folders: arrayOf(rawFolderEntry),
  documents: arrayOf(
    objectOf<RawDocumentEntry>({
      documentId: decodeString,
      parentFolderId: nullable(decodeString),
      name: nullable(decodeString),
      state: decodeEntityState,
    }),
  ),
  issues: arrayOf(decodeLoadIssue),
});
const rawSheetSnapshot = objectOf<RawSheetSnapshot>({
  sheetId: decodeString,
  name: nullable(decodeString),
  state: decodeEntityState,
  sheet: nullable(rawSheet),
});
const rawDocumentSnapshot = objectOf<RawDocumentSnapshot>({
  document: rawDocument,
  sheets: arrayOf(rawSheetSnapshot),
  issues: arrayOf(decodeLoadIssue),
});
const rawSelectedFolder = objectOf<{
  readonly selectionId: string;
  readonly displayPath: string;
}>({ selectionId: decodeString, displayPath: decodeString });
const rawSaveResult = objectOf<SaveResult>({ written: decodeBoolean });

function decodePayload<T>(
  decoder: Decoder<T>,
  payload: unknown,
): CommandResult<T> {
  const result: Decoded<T> = decoder(payload, PAYLOAD_ROOT);
  return result.ok
    ? commandOk(result.value)
    : commandErr("invalidCommandResponse", result.detail);
}

function fromDomain<T>(result: DomainResult<T>): CommandResult<T> {
  return result.ok
    ? commandOk(result.value)
    : commandErr(result.error.kind, result.error.detail);
}

function mapAll<A, B>(
  items: readonly A[],
  convert: (item: A) => CommandResult<B>,
): CommandResult<readonly B[]> {
  const converted: B[] = [];
  for (const item of items) {
    const result = convert(item);
    if (!result.ok) return result;
    converted.push(result.value);
  }
  return commandOk(converted);
}

function toParentFolderId(raw: string | null): CommandResult<FolderId | null> {
  return raw === null ? commandOk(null) : fromDomain(parseFolderId(raw));
}

function toFolderEntry(raw: RawFolderEntry): CommandResult<FolderEntry> {
  const folderId = fromDomain(parseFolderId(raw.folderId));
  if (!folderId.ok) return folderId;
  const parentFolderId = toParentFolderId(raw.parentFolderId);
  if (!parentFolderId.ok) return parentFolderId;
  const childOrder = mapAll(
    raw.childOrder,
    (entry): CommandResult<EntryId> => fromDomain(parseEntryId(entry)),
  );
  if (!childOrder.ok) return childOrder;
  return commandOk({
    folderId: folderId.value,
    name: raw.name,
    parentFolderId: parentFolderId.value,
    childOrder: childOrder.value,
    state: raw.state,
  });
}

function toProjectSnapshot(
  raw: RawProjectSnapshot,
): CommandResult<ProjectSnapshot> {
  const project = fromDomain(parseProject(raw.project));
  if (!project.ok) return project;
  const folders = mapAll(raw.folders, toFolderEntry);
  if (!folders.ok) return folders;
  const documents = mapAll(
    raw.documents,
    (entry): CommandResult<DocumentEntry> => {
      const documentId = fromDomain(parseDocumentId(entry.documentId));
      if (!documentId.ok) return documentId;
      const parentFolderId = toParentFolderId(entry.parentFolderId);
      if (!parentFolderId.ok) return parentFolderId;
      return commandOk({
        documentId: documentId.value,
        parentFolderId: parentFolderId.value,
        name: entry.name,
        state: entry.state,
      });
    },
  );
  if (!documents.ok) return documents;
  return commandOk({
    project: project.value,
    sessionGeneration: raw.sessionGeneration,
    folders: folders.value,
    documents: documents.value,
    issues: raw.issues,
  });
}

// "loaded" and a present sheet must agree; a mismatch means the payload is unusable.
function toSheetSnapshot(raw: RawSheetSnapshot): CommandResult<SheetSnapshot> {
  const sheetId = fromDomain(parseSheetId(raw.sheetId));
  if (!sheetId.ok) return sheetId;
  let sheet: Sheet | null = null;
  if (raw.sheet !== null) {
    const parsed = fromDomain(parseSheet(raw.sheet));
    if (!parsed.ok) return parsed;
    sheet = parsed.value;
  }
  if ((raw.state === "loaded") !== (sheet !== null)) {
    return commandErr(
      "invalidCommandResponse",
      `sheet ${raw.sheetId}: state ${raw.state} does not match the presence of its data`,
    );
  }
  return commandOk({
    sheetId: sheetId.value,
    name: raw.name,
    state: raw.state,
    sheet,
  });
}

export function toProjectSnapshotResult(
  payload: unknown,
): CommandResult<ProjectSnapshot> {
  const raw = decodePayload(rawProjectSnapshot, payload);
  return raw.ok ? toProjectSnapshot(raw.value) : raw;
}

interface RawOpenRequestResult {
  readonly snapshot: RawProjectSnapshot;
  readonly documentId: string | null;
  readonly resolution: OpenRequestResult["resolution"];
}
const rawOpenRequestResult = objectOf<RawOpenRequestResult>({
  snapshot: rawProjectSnapshot,
  documentId: nullable(decodeString),
  resolution: nullable(oneOf(ENTRY_POINT_RESOLUTIONS)),
});

// `null` means "no request pending for this window", which is a normal outcome.
export function toOpenRequestResult(
  payload: unknown,
): CommandResult<OpenRequestResult | null> {
  if (payload === null) return commandOk(null);
  const raw = decodePayload(rawOpenRequestResult, payload);
  if (!raw.ok) return raw;
  const snapshot = toProjectSnapshot(raw.value.snapshot);
  if (!snapshot.ok) return snapshot;
  // A Project folder request has no Document.
  if (raw.value.documentId === null) {
    return commandOk({
      snapshot: snapshot.value,
      documentId: null,
      resolution: raw.value.resolution,
    });
  }
  const documentId = fromDomain(parseDocumentId(raw.value.documentId));
  if (!documentId.ok) return documentId;
  return commandOk({
    snapshot: snapshot.value,
    documentId: documentId.value,
    resolution: raw.value.resolution,
  });
}

interface RawOpenInNewWindowResult {
  readonly status: OpenInNewWindowResult["status"];
}
const rawOpenInNewWindowStatus = objectOf<RawOpenInNewWindowResult>({
  status: oneOf(Object.values(OPEN_IN_NEW_WINDOW_STATUS)),
});
const rawFocusedExisting = objectOf<{ readonly inThisWindow: boolean }>({
  inThisWindow: decodeBoolean,
});

export function toOpenInNewWindowResult(
  payload: unknown,
): CommandResult<OpenInNewWindowResult> {
  const status = decodePayload(rawOpenInNewWindowStatus, payload);
  if (!status.ok) return status;
  if (status.value.status === OPEN_IN_NEW_WINDOW_STATUS.openedInNewWindow) {
    return commandOk({ status: OPEN_IN_NEW_WINDOW_STATUS.openedInNewWindow });
  }
  const focused = decodePayload(rawFocusedExisting, payload);
  return focused.ok
    ? commandOk({
        status: OPEN_IN_NEW_WINDOW_STATUS.focusedExisting,
        inThisWindow: focused.value.inThisWindow,
      })
    : focused;
}

export function toFolderSnapshotResult(
  payload: unknown,
): CommandResult<FolderSnapshot> {
  const raw = decodePayload(rawFolderEntry, payload);
  return raw.ok ? toFolderEntry(raw.value) : raw;
}

export function toFolderSelectionResult(
  payload: unknown,
): CommandResult<FolderSelection> {
  const status = decodePayload(
    objectOf<{ readonly status: FolderSelectionStatus }>({
      status: oneOf(Object.values(FOLDER_SELECTION_STATUS)),
    }),
    payload,
  );
  if (!status.ok) return status;
  if (status.value.status === FOLDER_SELECTION_STATUS.cancelled) {
    return commandOk({ status: FOLDER_SELECTION_STATUS.cancelled });
  }
  const selected = decodePayload(rawSelectedFolder, payload);
  return selected.ok
    ? commandOk({ status: FOLDER_SELECTION_STATUS.selected, ...selected.value })
    : selected;
}

export function toDocumentSnapshotResult(
  payload: unknown,
): CommandResult<DocumentSnapshot> {
  const raw = decodePayload(rawDocumentSnapshot, payload);
  if (!raw.ok) return raw;
  const document: CommandResult<Document> = fromDomain(
    parseDocument(raw.value.document),
  );
  if (!document.ok) return document;
  const sheets = mapAll(raw.value.sheets, toSheetSnapshot);
  if (!sheets.ok) return sheets;
  return commandOk({
    document: document.value,
    sheets: sheets.value,
    issues: raw.value.issues,
  });
}

export function toSheetSnapshotResult(
  payload: unknown,
): CommandResult<SheetSnapshot> {
  const raw = decodePayload(rawSheetSnapshot, payload);
  return raw.ok ? toSheetSnapshot(raw.value) : raw;
}

const decodeChangedFile = objectOf<ChangedFile>({
  path: decodeString,
  change: oneOf(FILE_CHANGE_KINDS),
  readable: decodeBoolean,
});
interface RawExternalChanges {
  readonly sessionGeneration: number;
  readonly watching: boolean;
  readonly rescan: boolean;
  readonly project: {
    readonly structure: boolean;
    readonly files: readonly ChangedFile[];
  };
  readonly documents: readonly {
    readonly documentId: string;
    readonly files: readonly ChangedFile[];
  }[];
}
const rawExternalChanges = objectOf<RawExternalChanges>({
  sessionGeneration: decodeNumber,
  watching: decodeBoolean,
  rescan: decodeBoolean,
  project: objectOf<RawExternalChanges["project"]>({
    structure: decodeBoolean,
    files: arrayOf(decodeChangedFile),
  }),
  documents: arrayOf(
    objectOf<RawExternalChanges["documents"][number]>({
      documentId: decodeString,
      files: arrayOf(decodeChangedFile),
    }),
  ),
});

// Shared by the `check_external_changes` result and the `projectFilesChanged` notification.
export function toExternalChanges(
  payload: unknown,
): CommandResult<ExternalChanges> {
  const raw = decodePayload(rawExternalChanges, payload);
  if (!raw.ok) return raw;
  const documents = mapAll(raw.value.documents, (entry) => {
    const documentId = fromDomain(parseDocumentId(entry.documentId));
    return documentId.ok
      ? commandOk({ documentId: documentId.value, files: entry.files })
      : documentId;
  });
  if (!documents.ok) return documents;
  return commandOk({
    sessionGeneration: raw.value.sessionGeneration,
    watching: raw.value.watching,
    rescan: raw.value.rescan,
    project: raw.value.project,
    documents: documents.value,
  });
}

interface RawBlockContentComparison {
  readonly outcome: BlockContentComparison["outcome"];
  readonly diff?: string;
  readonly limitBytes?: number;
}

export function toBlockContentComparison(
  payload: unknown,
): CommandResult<BlockContentComparison> {
  const head = decodePayload(
    objectOf<{ readonly outcome: RawBlockContentComparison["outcome"] }>({
      outcome: oneOf(BLOCK_COMPARISON_OUTCOMES),
    }),
    payload,
  );
  if (!head.ok) return head;
  switch (head.value.outcome) {
    case "text": {
      const text = decodePayload(
        objectOf<{ readonly diff: string }>({ diff: decodeString }),
        payload,
      );
      return text.ok
        ? commandOk({ outcome: "text", diff: text.value.diff })
        : text;
    }
    case "tooLarge": {
      const large = decodePayload(
        objectOf<{ readonly limitBytes: number }>({ limitBytes: decodeNumber }),
        payload,
      );
      return large.ok
        ? commandOk({ outcome: "tooLarge", limitBytes: large.value.limitBytes })
        : large;
    }
    case "identical":
    case "removedOnDisk":
    case "notUtf8":
      return commandOk({ outcome: head.value.outcome });
  }
}

const rawRepairOutcome = objectOf<RepairOutcome>({
  applied: decodeBoolean,
  files: arrayOf(decodeString),
  unavailable: nullable(oneOf(REPAIR_UNAVAILABLE_REASONS)),
  issues: arrayOf(decodeLoadIssue),
});

export function toRepairOutcome(
  payload: unknown,
): CommandResult<RepairOutcome> {
  return decodePayload(rawRepairOutcome, payload);
}

const rawFormatUpdateResult = objectOf<FormatUpdateResult>({
  updated: arrayOf(decodeString),
});

export function toFormatUpdateResult(
  payload: unknown,
): CommandResult<FormatUpdateResult> {
  return decodePayload(rawFormatUpdateResult, payload);
}

export function toSaveResult(payload: unknown): CommandResult<SaveResult> {
  return decodePayload(rawSaveResult, payload);
}

export function toContentPathResult(payload: unknown) {
  const text = decodePayload(decodeString, payload);
  return text.ok ? fromDomain(parseContentPath(text.value)) : text;
}

export function toTextResult(payload: unknown): CommandResult<string> {
  return decodePayload(decodeString, payload);
}

// Rust returns `()`, which arrives as null.
export function toVoidResult(payload: unknown): CommandResult<null> {
  return payload === null || payload === undefined
    ? commandOk(null)
    : commandErr("invalidCommandResponse", "payload: expected no value");
}
