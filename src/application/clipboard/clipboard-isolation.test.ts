import { describe, expect, it } from "vitest";

const sources = import.meta.glob("./*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("clipboard module", () => {
  it("does not use OS or browser clipboard APIs", () => {
    const productionFiles = Object.entries(sources).filter(
      ([path]) => !path.endsWith(".test.ts"),
    );
    expect(productionFiles.length).toBeGreaterThan(0);
    for (const [path, source] of productionFiles) {
      expect(source, path).not.toMatch(
        /\bnavigator\b|(?<![.\w])(window|document)\.|ClipboardEvent/,
      );
    }
  });
});
