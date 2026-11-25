import { describe, expect, it } from "vitest";
import { isTextBlockType } from "./block/block-type";
import { pieEditability } from "./diagram/pie/pie-editability";
import { pieMeaningOf } from "./diagram/pie/pie-meaning";
import { planPieOperation } from "./diagram/pie/pie-operations";
import { parsePie } from "./diagram/pie/pie-parser";
import { parseDocument } from "./document/document";
import {
  DOMAIN_ERROR_KINDS,
  TS_ONLY_DOMAIN_ERROR_KINDS,
} from "./shared/domain-error";
import { replaceAll } from "./text-search/text-search";

describe("block types and error kinds", () => {
  it("tells text blocks from image blocks", () => {
    expect(isTextBlockType("markdown")).toBe(true);
    expect(isTextBlockType("mermaid")).toBe(true);
    expect(isTextBlockType("image")).toBe(false);
  });

  it("keeps the TypeScript-only kinds apart from the shared ones", () => {
    for (const kind of TS_ONLY_DOMAIN_ERROR_KINDS) {
      expect(DOMAIN_ERROR_KINDS as readonly string[]).not.toContain(kind);
    }
  });
});

describe("documents", () => {
  it("refuses a sheet id in the order that is not one", () => {
    const parsed = parseDocument({
      schemaVersion: 1,
      documentId: "01928f3a-6c7d-7e8f-a012-3456789abcde",
      name: "Doc",
      sheetOrder: ["nope"],
    });
    expect(!parsed.ok && parsed.error.kind).toBe("invalidEntityId");
  });
});

describe("text search replacements", () => {
  const regex = (text: string) => ({ text, matchCase: true, regex: true });

  it("puts an empty text for a group that took no part", () => {
    expect(replaceAll("ab", regex("a(x)?"), "[$1]").text).toBe("[]b");
    expect(replaceAll("ab", regex("a(?<n>x)?"), "[$<n>]").text).toBe("[]b");
    expect(replaceAll("ab", regex("a"), "[$<n>]").text).toBe("[]b");
  });

  it("leaves an empty text and an invalid pattern alone", () => {
    expect(replaceAll("", regex("a"), "b")).toEqual({ text: "", count: 0 });
    expect(replaceAll("a", regex("("), "b")).toEqual({ text: "a", count: 0 });
  });
});

describe("pie charts", () => {
  const NO_BREAK_SPACE = " ";

  it("reads a comment on the header line", () => {
    expect(pieEditability(parsePie('pie %% note\n  "A" : 1\n')).editable).toBe(
      true,
    );
  });

  it.each([
    ["a header followed by a no-break space", `pie${NO_BREAK_SPACE}title T\n`],
    [
      "a directive with a no-break space before it",
      `${NO_BREAK_SPACE}%%{init: {}}%%\npie\n`,
    ],
  ])("is not editable with %s", (_what, source) => {
    expect(pieEditability(parsePie(source)).editable).toBe(false);
  });

  it("reads what follows a multi-line accDescr block on its closing line", () => {
    for (const close of ["}", "} %% done"]) {
      const parsed = parsePie(`pie\n    accDescr {\n    text\n    ${close}\n`);
      expect(pieEditability(parsed).editable).toBe(true);
    }
  });

  it("is not editable when the header starts with a no-break space", () => {
    expect(pieEditability(parsePie(`${NO_BREAK_SPACE}pie\n`)).editable).toBe(
      false,
    );
  });

  it("has no title and no showData without a header", () => {
    expect(pieMeaningOf(parsePie(""))).toMatchObject({
      title: "",
      showData: false,
    });
  });

  it("refuses a slice index that is not a whole number, and keeps a title that is the same", () => {
    const source = 'pie title T\n    "A" : 1\n';
    const deleted = planPieOperation(source, {
      kind: "deleteSlice",
      target: { index: 0.5, label: "A" },
    });
    expect(deleted.ok).toBe(false);
    const same = planPieOperation(source, { kind: "setTitle", title: "T" });
    expect(same.ok && same.value.edits).toEqual([]);
  });

  it("refuses a title Mermaid would read as a style definition", () => {
    const result = planPieOperation("pie\n", {
      kind: "setTitle",
      title: "style a:#-;",
    });
    expect(result.ok).toBe(false);
  });
});
