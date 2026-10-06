import { describe, expect, it } from "vitest";
import { parseBlock, type RawBlock } from "./block/block";
import { parseBlockType } from "./block/block-type";
import { parseContentPath } from "./block/content-path";
import { parseDocument, type RawDocument } from "./document/document";
import type { SchemaEntityKind } from "./domain-constants";
import { parseFolder, type RawFolder } from "./folder/folder";
import { parseProject, type RawProject } from "./project/project";
import { parseDisplayName } from "./shared/display-name";
import type { DomainResult } from "./shared/domain-result";
import { parseProjectId } from "./shared/entity-id";
import {
  parsePosition,
  parseSize,
  type RawPosition,
  type RawSize,
} from "./shared/geometry";
import { parseSchemaVersion } from "./shared/schema-version";
import { parseSheet, type RawSheet } from "./sheet/sheet";

const CURRENT_LANGUAGE = "ts";
const KNOWN_LANGUAGES: readonly string[] = ["ts", "rust"];
const DEFAULT_TARGETS: readonly string[] = KNOWN_LANGUAGES;
const SUPPORTED_FIXTURE_VERSION = 1;

interface FixtureCase {
  readonly name: string;
  readonly input: unknown;
  readonly expected: { readonly result: string; readonly errorKind?: string };
  readonly targets?: readonly string[];
}

interface FixtureFile {
  readonly fixtureVersion: number;
  readonly subject: string;
  readonly cases: readonly FixtureCase[];
}

// Fixture inputs are checked by the domain validators themselves; these casts only
// select the per-subject input shape documented in docs/testing.md §8.
type SubjectRunner = (input: unknown) => DomainResult<unknown>;

const SUBJECT_RUNNERS: Readonly<Record<string, SubjectRunner>> = {
  entityId: (input) => parseProjectId(input as string),
  displayName: (input) => parseDisplayName(input as string),
  position: (input) => parsePosition(input as RawPosition),
  size: (input) => parseSize(input as RawSize),
  blockType: (input) => parseBlockType(input as string),
  schemaVersion: (input) => {
    const { entity, value } = input as {
      entity: SchemaEntityKind;
      value: number;
    };
    return parseSchemaVersion(entity, value);
  },
  contentPath: (input) => parseContentPath((input as { path: string }).path),
  entity: (input) => {
    const { entity, value } = input as { entity: string; value: unknown };
    switch (entity) {
      case "project":
        return parseProject(value as RawProject);
      case "folder":
        return parseFolder(value as RawFolder);
      case "document":
        return parseDocument(value as RawDocument);
      case "sheet":
        return parseSheet(value as RawSheet);
      case "block":
        return parseBlock(value as RawBlock);
      default:
        throw new Error(`unknown entity kind in fixture: ${entity}`);
    }
  },
};

const fixtureModules = import.meta.glob<FixtureFile>(
  "../../fixtures/domain/*.json",
  {
    eager: true,
    import: "default",
  },
);
const fixtureEntries = Object.entries(fixtureModules);

function targetsOf(fixtureCase: FixtureCase): readonly string[] {
  return fixtureCase.targets ?? DEFAULT_TARGETS;
}

function runCase(runner: SubjectRunner, fixtureCase: FixtureCase): void {
  const result = runner(fixtureCase.input);
  if (fixtureCase.expected.result === "accept") {
    expect(
      result.ok,
      result.ok ? "" : `${result.error.kind}: ${result.error.detail}`,
    ).toBe(true);
    return;
  }
  expect(fixtureCase.expected.result).toBe("reject");
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe(fixtureCase.expected.errorKind);
  }
}

describe("domain fixtures", () => {
  it("finds fixture files and covers every subject", () => {
    expect(fixtureEntries.length).toBeGreaterThan(0);
    const subjects = fixtureEntries.map(([, file]) => file.subject).sort();
    expect(subjects).toEqual(Object.keys(SUBJECT_RUNNERS).sort());
  });

  for (const [path, file] of fixtureEntries) {
    describe(path, () => {
      it("has a supported fixtureVersion and a known subject", () => {
        expect(file.fixtureVersion).toBe(SUPPORTED_FIXTURE_VERSION);
        expect(Object.keys(SUBJECT_RUNNERS)).toContain(file.subject);
      });

      const runner = SUBJECT_RUNNERS[file.subject];
      for (const fixtureCase of file.cases) {
        const label = `${file.subject}: ${fixtureCase.name}`;
        const unknownTargets = targetsOf(fixtureCase).filter(
          (t) => !KNOWN_LANGUAGES.includes(t),
        );
        if (unknownTargets.length > 0) {
          it(label, () => {
            expect.fail(`unknown targets: ${unknownTargets.join(", ")}`);
          });
        } else if (targetsOf(fixtureCase).includes(CURRENT_LANGUAGE)) {
          it(label, () => {
            if (runner === undefined)
              expect.fail(`unknown subject: ${file.subject}`);
            runCase(runner, fixtureCase);
          });
        }
      }
    });
  }
});
