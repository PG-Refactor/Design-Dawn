// Runs the shared fixtures in fixtures/app-state/ against the TypeScript validators.
// The Rust runner is src-tauri/tests/app_state_fixtures.rs.

import { describe, expect, it } from "vitest";
import { parseLanguagePreference } from "./language";
import type { LocalStateResult } from "./local-state-result";
import { parseTextSize } from "./text-size";
import { parseThemePreference } from "./theme";
import { parseViewport, type RawViewport } from "./viewport";

const CURRENT_LANGUAGE = "ts";
const KNOWN_LANGUAGES: readonly string[] = ["ts", "rust"];
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

// The casts only select the per-subject input shape of each fixture file.
type SubjectRunner = (input: unknown) => LocalStateResult<unknown>;

const SUBJECT_RUNNERS: Readonly<Record<string, SubjectRunner>> = {
  languagePreference: (input) => parseLanguagePreference(input as string),
  textSize: (input) => parseTextSize(input as string),
  themePreference: (input) => parseThemePreference(input as string),
  viewport: (input) => parseViewport(input as RawViewport),
};

const fixtureModules = import.meta.glob<FixtureFile>(
  "../../../fixtures/app-state/*.json",
  { eager: true, import: "default" },
);
const fixtureEntries = Object.entries(fixtureModules);

function targetsOf(fixtureCase: FixtureCase): readonly string[] {
  return fixtureCase.targets ?? KNOWN_LANGUAGES;
}

describe("app-state fixtures", () => {
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
        const unknownTargets = targetsOf(fixtureCase).filter(
          (target) => !KNOWN_LANGUAGES.includes(target),
        );
        if (unknownTargets.length > 0) {
          it(`${file.subject}: ${fixtureCase.name}`, () => {
            expect.fail(`unknown targets: ${unknownTargets.join(", ")}`);
          });
        } else if (targetsOf(fixtureCase).includes(CURRENT_LANGUAGE)) {
          it(`${file.subject}: ${fixtureCase.name}`, () => {
            if (runner === undefined) {
              expect.fail(`unknown subject: ${file.subject}`);
            }
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
          });
        }
      }
    });
  }
});
