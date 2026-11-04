import { describe, expect, it } from "vitest";
import { parseProjectFolderName } from "./project-folder-name";

describe("parseProjectFolderName", () => {
  it("accepts one safe segment, also with spaces and non-ASCII letters", () => {
    for (const valid of ["Order Service", "設計書", "project-1", "a.b"]) {
      expect(parseProjectFolderName(valid).ok).toBe(true);
    }
  });

  it("refuses what Rust refuses", () => {
    for (const invalid of [
      "",
      "a/b",
      "a\\b",
      "..",
      ".",
      "name.",
      "name ",
      "CON",
      "aux.txt",
      "com1",
      "a:b",
      "a?b",
      "tab\there",
    ]) {
      const result = parseProjectFolderName(invalid);
      expect(result.ok, invalid).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalidFolderName");
    }
  });
});
