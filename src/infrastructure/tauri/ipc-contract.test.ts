// TypeScript side of the IPC contract in fixtures/ipc/ (the Rust side is
// src-tauri/tests/ipc_contract.rs). Each case is replayed through the real client wrapper
// with `invoke` mocked, which proves two things at once: the wrapper sends exactly the
// `request` Rust is tested with, and it decodes exactly the response / error Rust produces.

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import applicationErrorSource from "../../../src-tauri/src/application/error.rs?raw";
import domainErrorSource from "../../../src-tauri/src/domain/error.rs?raw";
import persistenceErrorSource from "../../../src-tauri/src/infrastructure/error.rs?raw";
import { parseLanguagePreference } from "../../application/local-state/language";
import { LOCAL_STATE_ERROR_KINDS } from "../../application/local-state/local-state-result";
import {
  parseThemePreference,
  type ThemePreference,
} from "../../application/local-state/theme";
import {
  parseViewport,
  type RawViewport,
} from "../../application/local-state/viewport";
import type { LanguagePreference } from "../../config/language-config";
import { parseBlockType } from "../../domain/block/block-type";
import { parseContentPath } from "../../domain/block/content-path";
import { parseFolder, type RawFolder } from "../../domain/folder/folder";
import { parseDisplayName } from "../../domain/shared/display-name";
import { DOMAIN_ERROR_KINDS } from "../../domain/shared/domain-error";
import {
  parseDocumentId,
  parseEntryId,
  parseFolderId,
  parseProjectId,
  parseSheetId,
} from "../../domain/shared/entity-id";
import { unwrap } from "../../domain/shared/test-support";
import { parseSheet, type RawSheet } from "../../domain/sheet/sheet";
import { copyAssetToDocument, importDroppedImages } from "./asset-client";
import {
  ASSET_ERROR_KINDS,
  FOLDER_ERROR_KINDS,
  FOLDER_SELECTION_ERROR_KINDS,
  GIT_ERROR_KINDS,
  PERSISTENCE_ERROR_KINDS,
  RUST_ONLY_DOMAIN_ERROR_KINDS,
  SESSION_ERROR_KINDS,
} from "./command-constants";
import { type CommandResult, toCommandError } from "./command-error";
import {
  getAppSettings,
  getSheetViewport,
  saveSheetViewport,
  setAutoSave,
  setLanguagePreference,
  setProjectTreeWidth,
  setThemePreference,
} from "./local-state-client";
import {
  acceptDiskState,
  checkExternalChanges,
  closeDocument,
  compareBlockContent,
  createBlockContent,
  createDocument,
  createFolder,
  createProject,
  deleteFolder,
  deleteSheet,
  loadDocument,
  moveEntry,
  openProject,
  readBlockContent,
  reloadProject,
  repairLoadIssue,
  restoreBlockContent,
  saveFolder,
  saveSheet,
  selectProjectFolder,
  updateOutdatedFiles,
} from "./persistence-client";
import type { LoadIssueRef, RepairAction } from "./persistence-types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const CURRENT_TARGET = "ts";
const KNOWN_TARGETS: readonly string[] = ["ts", "rust"];
const SUPPORTED_FIXTURE_VERSION = 1;
const SELECTION_ID_PLACEHOLDER = "$selectionId";
// Any value works: the client treats the id as opaque. Rust issues a UUIDv7 in reality.
const SELECTION_ID = "01928f3a-aaaa-7bbb-8ccc-0123456789ab";
const DETAIL_TEXT = "developer-facing detail from Rust";
// What Tauri itself returns for a missing argument (observed in the Rust side of this contract).
const TAURI_STRING_ERROR =
  "invalid args `selectionId` for command `open_project`: command open_project missing required key selectionId";

interface ContractCase {
  readonly name: string;
  readonly targets?: readonly string[];
  readonly request: {
    readonly command: string;
    readonly args: Readonly<Record<string, unknown>>;
  };
  readonly expected: {
    readonly ok?: unknown;
    readonly error?: { readonly kind: string };
    readonly tauriError?: boolean;
  };
}
interface ContractScenario {
  readonly name: string;
  readonly cases: readonly ContractCase[];
}
interface ContractFile {
  readonly fixtureVersion: number;
  readonly scenarios: readonly ContractScenario[];
}

const contractModules = import.meta.glob<ContractFile>(
  "../../../fixtures/ipc/*.json",
  { eager: true, import: "default" },
);
const contractFiles = Object.entries(contractModules);

type Args = Readonly<Record<string, unknown>>;
type Wrapper = (args: Args) => Promise<CommandResult<unknown>>;

// Arguments are parsed into the branded domain types exactly as an application caller would.
// Cases whose arguments those parsers reject are marked `rust` in the fixture.
const id = {
  project: (args: Args) => unwrap(parseProjectId(args.projectId as string)),
  document: (args: Args) => unwrap(parseDocumentId(args.documentId as string)),
  optionalDocument: (args: Args) =>
    args.documentId === null || args.documentId === undefined
      ? null
      : unwrap(parseDocumentId(args.documentId as string)),
  sheet: (args: Args) => unwrap(parseSheetId(args.sheetId as string)),
  contentPath: (args: Args) =>
    unwrap(parseContentPath(args.contentPath as string)),
  folder: (args: Args) => unwrap(parseFolderId(args.folderId as string)),
  parentFolder: (args: Args) =>
    args.parentFolderId === null || args.parentFolderId === undefined
      ? null
      : unwrap(parseFolderId(args.parentFolderId as string)),
  blockType: (args: Args) => unwrap(parseBlockType(args.blockType as string)),
};

function unwrapTheme(
  result: ReturnType<typeof parseThemePreference>,
): ThemePreference {
  if (!result.ok)
    throw new Error(`invalid theme in fixture: ${result.error.kind}`);
  return result.value;
}

function unwrapLanguage(
  result: ReturnType<typeof parseLanguagePreference>,
): LanguagePreference {
  if (!result.ok)
    throw new Error(`invalid language in fixture: ${result.error.kind}`);
  return result.value;
}

function unwrapViewport(result: ReturnType<typeof parseViewport>) {
  if (!result.ok)
    throw new Error(`invalid viewport in fixture: ${result.error.kind}`);
  return result.value;
}

const WRAPPERS: Readonly<Record<string, Wrapper>> = {
  select_project_folder: () => selectProjectFolder(),
  open_project: (args) => openProject(args.selectionId as string),
  reload_project: (args) => reloadProject(id.project(args)),
  check_external_changes: (args) => checkExternalChanges(id.project(args)),
  compare_block_content: (args) =>
    compareBlockContent(
      id.project(args),
      id.document(args),
      id.contentPath(args),
      args.text as string,
    ),
  accept_disk_state: (args) =>
    acceptDiskState(id.project(args), id.optionalDocument(args)),
  repair_load_issue: (args) =>
    repairLoadIssue(
      id.project(args),
      id.optionalDocument(args),
      args.issue as LoadIssueRef,
      args.action as RepairAction,
      args.dryRun as boolean,
    ),
  update_outdated_files: (args) => updateOutdatedFiles(id.project(args)),
  create_project: (args) =>
    createProject(
      args.selectionId as string,
      unwrap(parseDisplayName(args.name as string)),
    ),
  create_document: (args) =>
    createDocument(
      id.project(args),
      id.document(args),
      unwrap(parseDisplayName(args.name as string)),
      id.parentFolder(args),
    ),
  create_folder: (args) =>
    createFolder(
      id.project(args),
      id.parentFolder(args),
      id.folder(args),
      unwrap(parseDisplayName(args.name as string)),
    ),
  save_folder: (args) =>
    saveFolder(id.project(args), unwrap(parseFolder(args.folder as RawFolder))),
  move_entry: (args) =>
    moveEntry(
      id.project(args),
      unwrap(parseEntryId(args.entryId as string)),
      args.targetParentFolderId === null
        ? null
        : unwrap(parseFolderId(args.targetParentFolderId as string)),
    ),
  delete_folder: (args) => deleteFolder(id.project(args), id.folder(args)),
  load_document: (args) => loadDocument(id.project(args), id.document(args)),
  close_document: (args) => closeDocument(id.project(args), id.document(args)),
  save_sheet: (args) =>
    saveSheet(
      id.project(args),
      id.document(args),
      unwrap(parseSheet(args.sheet as RawSheet)),
    ),
  read_block_content: (args) =>
    readBlockContent(id.project(args), id.document(args), id.contentPath(args)),
  create_block_content: (args) =>
    createBlockContent(
      id.project(args),
      id.document(args),
      id.sheet(args),
      id.blockType(args),
      args.text as string,
    ),
  restore_block_content: (args) =>
    restoreBlockContent(
      id.project(args),
      id.document(args),
      id.blockType(args),
      id.contentPath(args),
      args.text as string,
    ),
  delete_sheet: (args) =>
    deleteSheet(id.project(args), id.document(args), id.sheet(args)),
  import_dropped_images: (args) =>
    importDroppedImages(
      args.dropId as string,
      id.project(args),
      id.document(args),
    ),
  copy_asset_to_document: (args) =>
    copyAssetToDocument(
      id.project(args),
      unwrap(parseDocumentId(args.sourceDocumentId as string)),
      id.contentPath(args),
      unwrap(parseDocumentId(args.targetDocumentId as string)),
    ),
  get_app_settings: () => getAppSettings(),
  set_theme_preference: (args) =>
    setThemePreference(
      unwrapTheme(parseThemePreference(args.themePreference as string)),
    ),
  set_language_preference: (args) =>
    setLanguagePreference(
      unwrapLanguage(
        parseLanguagePreference(args.languagePreference as string),
      ),
    ),
  set_auto_save: (args) => setAutoSave(args.enabled as boolean),
  set_project_tree_width: (args) => setProjectTreeWidth(args.width as number),
  get_sheet_viewport: (args) =>
    getSheetViewport(id.project(args), id.document(args), id.sheet(args)),
  save_sheet_viewport: (args) =>
    saveSheetViewport(
      id.project(args),
      id.document(args),
      id.sheet(args),
      unwrapViewport(parseViewport(args.viewport as RawViewport)),
    ),
};

function substituteSelectionId(value: unknown): unknown {
  if (value === SELECTION_ID_PLACEHOLDER) return SELECTION_ID;
  if (Array.isArray(value)) return value.map(substituteSelectionId);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        substituteSelectionId(item),
      ]),
    );
  }
  return value;
}

function targetsOf(contractCase: ContractCase): readonly string[] {
  return contractCase.targets ?? KNOWN_TARGETS;
}

function allCases(file: ContractFile): readonly ContractCase[] {
  return file.scenarios.flatMap((scenario) => scenario.cases);
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("ipc contract fixtures", () => {
  it("finds a contract file", () => {
    expect(contractFiles.length).toBeGreaterThan(0);
  });

  for (const [path, file] of contractFiles) {
    describe(path, () => {
      it("has a supported fixtureVersion and only known targets", () => {
        expect(file.fixtureVersion).toBe(SUPPORTED_FIXTURE_VERSION);
        for (const contractCase of allCases(file)) {
          for (const target of targetsOf(contractCase)) {
            expect(KNOWN_TARGETS, contractCase.name).toContain(target);
          }
        }
      });

      for (const scenario of file.scenarios) {
        for (const contractCase of scenario.cases) {
          if (!targetsOf(contractCase).includes(CURRENT_TARGET)) continue;
          it(`${scenario.name}: ${contractCase.name}`, async () => {
            const { command, args } = contractCase.request;
            const wrapper = WRAPPERS[command];
            if (wrapper === undefined) {
              expect.fail(`no client wrapper mapped for ${command}`);
            }
            const sentArgs = substituteSelectionId(args) as Args;
            const { expected } = contractCase;
            if (expected.error !== undefined) {
              invokeMock.mockRejectedValueOnce({
                kind: expected.error.kind,
                detail: DETAIL_TEXT,
              });
            } else if (expected.tauriError === true) {
              invokeMock.mockRejectedValueOnce(TAURI_STRING_ERROR);
            } else {
              invokeMock.mockResolvedValueOnce(
                substituteSelectionId(expected.ok),
              );
            }

            const result = await wrapper(sentArgs);

            // Strict equality: the wrapper may not add, drop or rename an argument.
            expect(invokeMock.mock.calls).toStrictEqual([[command, sentArgs]]);
            if (expected.error !== undefined) {
              expect(result).toStrictEqual({
                ok: false,
                error: { kind: expected.error.kind, detail: DETAIL_TEXT },
              });
            } else if (expected.tauriError === true) {
              expect(result).toStrictEqual({
                ok: false,
                error: {
                  kind: "unexpectedCommandError",
                  detail: TAURI_STRING_ERROR,
                },
              });
            } else {
              expect(result).toStrictEqual({
                ok: true,
                value: substituteSelectionId(expected.ok),
              });
            }
          });
        }
      }

      it("keeps at least one Tauri-originated error case so the string form stays pinned", () => {
        const tauriCases = allCases(file).filter(
          (contractCase) => contractCase.expected.tauriError === true,
        );
        expect(tauriCases.length).toBeGreaterThan(0);
      });
    });
  }
});

describe("Tauri's own string errors", () => {
  it("map to unexpectedCommandError and keep the original message", async () => {
    invokeMock.mockRejectedValueOnce(TAURI_STRING_ERROR);
    const result = await openProject(SELECTION_ID);
    expect(result).toStrictEqual({
      ok: false,
      error: { kind: "unexpectedCommandError", detail: TAURI_STRING_ERROR },
    });
  });
});

const KIND_LITERAL_PATTERN = /=> "([A-Za-z]+)"/g;

function kindsIn(source: string): string[] {
  return [...source.matchAll(KIND_LITERAL_PATTERN)].map((match) => {
    const kind = match[1];
    if (kind === undefined) throw new Error("kind pattern without a group");
    return kind;
  });
}

describe("error kinds shared with Rust", () => {
  // `application/error.rs` owns the session-level kinds; the domain and persistence
  // enums each own theirs (every identifier is defined once, in an `as_str`).
  const rustKinds = [
    ...kindsIn(domainErrorSource),
    ...kindsIn(persistenceErrorSource),
    ...kindsIn(applicationErrorSource),
  ].sort();

  it("finds the Rust identifiers", () => {
    expect(rustKinds.length).toBeGreaterThan(0);
    expect(new Set(rustKinds).size).toBe(rustKinds.length);
  });

  it("lists exactly the identifiers Rust can return", () => {
    const typeScriptKinds = [
      ...new Set([
        ...DOMAIN_ERROR_KINDS,
        ...RUST_ONLY_DOMAIN_ERROR_KINDS,
        ...PERSISTENCE_ERROR_KINDS,
        ...SESSION_ERROR_KINDS,
        ...FOLDER_SELECTION_ERROR_KINDS,
        ...ASSET_ERROR_KINDS,
        ...FOLDER_ERROR_KINDS,
        ...GIT_ERROR_KINDS,
        ...LOCAL_STATE_ERROR_KINDS,
      ]),
    ].sort();
    expect(typeScriptKinds).toEqual(rustKinds);
  });

  it("never degrades a Rust kind to unexpectedCommandError", () => {
    for (const kind of rustKinds) {
      expect(toCommandError({ kind, detail: "d" }).kind).toBe(kind);
    }
  });
});
