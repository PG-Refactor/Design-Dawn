import { describe, expect, it } from "vitest";
import {
  parseBlockId,
  parseDocumentId,
  parseProjectId,
  parseSheetId,
} from "../domain/shared/entity-id";
import {
  generateBlockId,
  generateDocumentId,
  generateProjectId,
  generateSheetId,
} from "./entity-id-generator";

const SUCCESSIVE_ID_COUNT = 1000;
const VERSION_CHARACTER_INDEX = 14;
const EXPECTED_VERSION = "7";

describe("entity id generator", () => {
  it("generates IDs accepted by the domain parsers", () => {
    expect(parseProjectId(generateProjectId()).ok).toBe(true);
    expect(parseDocumentId(generateDocumentId()).ok).toBe(true);
    expect(parseSheetId(generateSheetId()).ok).toBe(true);
    expect(parseBlockId(generateBlockId()).ok).toBe(true);
  });

  it("generates version 7 IDs", () => {
    expect(generateBlockId()[VERSION_CHARACTER_INDEX]).toBe(EXPECTED_VERSION);
  });

  it("generates successive IDs that sort ascending as strings", () => {
    const generated = Array.from({ length: SUCCESSIVE_ID_COUNT }, () =>
      generateBlockId(),
    );
    expect([...generated].sort()).toEqual(generated);
    expect(new Set(generated).size).toBe(SUCCESSIVE_ID_COUNT);
  });
});
