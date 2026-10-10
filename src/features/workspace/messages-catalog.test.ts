import { describe, expect, it } from "vitest";
import { DISPLAY_LANGUAGES } from "../../config/language-config";
import { entitySubject } from "./ui-state/ui-state";
import { messagesFor } from "./use-messages";
import { describeOperationFailure } from "./workspace-messages";

type CatalogNode =
  | string
  | ((...parameters: string[]) => string)
  | { readonly [key: string]: CatalogNode };

interface Leaf {
  readonly path: string;
  readonly value: string | ((...parameters: string[]) => string);
}

function leavesOf(node: CatalogNode, path: string): readonly Leaf[] {
  if (typeof node === "string" || typeof node === "function") {
    return [{ path, value: node }];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    leavesOf(child, path === "" ? key : `${path}.${key}`),
  );
}

function leavesFor(language: (typeof DISPLAY_LANGUAGES)[number]) {
  return leavesOf(messagesFor(language) as unknown as CatalogNode, "");
}

// Functions get string arguments: only "is there a sentence" is checked here, the numeric
// ones have their own tests below.
const SAMPLE_ARGUMENT = "sample";
const callWithSamples = (leaf: Leaf): string =>
  typeof leaf.value === "string"
    ? leaf.value
    : leaf.value(SAMPLE_ARGUMENT, SAMPLE_ARGUMENT, SAMPLE_ARGUMENT);

describe("message catalogs", () => {
  it("scans every catalog", () => {
    expect(leavesFor("ja").length).toBeGreaterThan(200);
  });

  for (const language of DISPLAY_LANGUAGES) {
    it(`has a non-empty text for every entry in ${language}`, () => {
      const empty = leavesFor(language)
        .filter((leaf) => callWithSamples(leaf).trim() === "")
        .map((leaf) => leaf.path);
      expect(empty).toEqual([]);
    });
  }

  it("has the same keys, with the same kinds of entry, in every language", () => {
    const shape = (language: (typeof DISPLAY_LANGUAGES)[number]) =>
      leavesFor(language).map((leaf) => `${leaf.path}:${typeof leaf.value}`);
    const [reference, ...others] = DISPLAY_LANGUAGES;
    if (reference === undefined) throw new Error("no display language");
    for (const language of others) {
      expect(shape(language)).toEqual(shape(reference));
    }
  });

  it("puts the variable parts of a sentence into it", () => {
    for (const language of DISPLAY_LANGUAGES) {
      const { workspace, git, canvas, markdown, image } = messagesFor(language);
      expect(workspace.closeTabLabel("Doc X")).toContain("Doc X");
      expect(workspace.deleteConfirmationTitle("Doc X")).toContain("Doc X");
      expect(workspace.moveEntryTitle("Doc X")).toContain("Doc X");
      expect(workspace.treeMenuLabel("Doc X")).toContain("Doc X");
      expect(git.commitIdLabel("abc123")).toContain("abc123");
      expect(git.diffTooLargeText("1 MiB")).toContain("1 MiB");
      expect(git.renamedPathText("a.md", "b.md")).toMatch(/a\.md.*b\.md/);
      expect(canvas.resizeHandleLabel("markdown ab12")).toContain(
        "markdown ab12",
      );
      expect(markdown.previewLabel("ab12")).toContain("ab12");
      expect(image.altText("ab12")).toContain("ab12");
    }
  });

  it("counts blocks and notifications", () => {
    for (const language of DISPLAY_LANGUAGES) {
      const { workspace } = messagesFor(language);
      expect(workspace.skippedBlocks(1)).toContain("1");
      expect(workspace.skippedBlocks(3)).toContain("3");
      const mixed = workspace.notificationCounts(2, 5);
      expect(mixed).toContain("2");
      expect(mixed).toContain("5");
      expect(workspace.notificationCounts(0, 3)).toContain("3");
      expect(workspace.notificationCounts(0, 3)).not.toBe(mixed);
      expect(workspace.notificationCounts(0, 0).trim()).not.toBe("");
    }
  });
});

describe("operation failure subjects", () => {
  it("names an entity whose name could not be loaded with the placeholder of each language", () => {
    for (const language of DISPLAY_LANGUAGES) {
      const { workspace } = messagesFor(language);
      const text = describeOperationFailure(
        workspace,
        "deleteSheet",
        entitySubject(null),
        "ioError",
      );
      expect(text).toContain(workspace.tree.unnamedEntity);
      expect(
        describeOperationFailure(
          workspace,
          "deleteSheet",
          entitySubject("Sheet 1"),
          "ioError",
        ),
      ).toContain("Sheet 1");
    }
  });
});
