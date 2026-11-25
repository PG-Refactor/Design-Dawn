import { describe, expect, it } from "vitest";
import {
  markdownImageDestination,
  markdownImageReference,
  resolveMarkdownImagePath,
} from "./markdown-image-path";

const MARKDOWN_FILE = "sheets/overview/blocks/markdown-1.md";

describe("resolveMarkdownImagePath", () => {
  it("resolves a path relative to the Markdown file to the Document's assets", () => {
    expect(
      resolveMarkdownImagePath(MARKDOWN_FILE, "../../../assets/flow.png"),
    ).toBe("assets/flow.png");
    expect(
      resolveMarkdownImagePath(MARKDOWN_FILE, "./../../../assets/flow.png"),
    ).toBe("assets/flow.png");
    expect(
      resolveMarkdownImagePath(
        MARKDOWN_FILE,
        "../../overview/../../assets/a.png",
      ),
    ).toBe("assets/a.png");
  });

  it("decodes percent-encoding segment by segment", () => {
    expect(
      resolveMarkdownImagePath(MARKDOWN_FILE, "../../../assets/my%20flow.png"),
    ).toBe("assets/my flow.png");
    expect(
      resolveMarkdownImagePath(MARKDOWN_FILE, "../../../assets/%E5%9B%B3.png"),
    ).toBe("assets/図.png");
  });

  it.each([
    ["a URL", "https://example.com/a.png"],
    ["a file URL", "file:///C:/a.png"],
    ["a drive path", "C:/a.png"],
    ["an absolute path", "/assets/a.png"],
    ["a backslash", "..\\..\\..\\assets\\a.png"],
    ["a query", "../../../assets/a.png?x=1"],
    ["a fragment", "../../../assets/a.png#x"],
    ["a path that leaves the Document", "../../../../assets/a.png"],
    ["leaving and coming back", "../../../../doc/assets/a.png"],
    ["a file next to the Markdown file", "a.png"],
    ["the assets path written from the Document root", "assets/a.png"],
    ["a sub-folder of assets", "../../../assets/sub/a.png"],
    ["the assets folder itself", "../../../assets"],
    ["an encoded separator", "../../../assets%2Fa.png"],
    ["an encoded parent segment", "../../%2E%2E/assets/a.png"],
    ["a broken escape", "../../../assets/%E5.png"],
    ["an empty segment", "../../..//assets/a.png"],
    ["an empty destination", ""],
  ])("refuses %s", (_label, destination) => {
    expect(resolveMarkdownImagePath(MARKDOWN_FILE, destination)).toBeNull();
  });
});

describe("markdownImageDestination", () => {
  it("writes the relative form that resolves back to the asset", () => {
    const destination = markdownImageDestination(
      MARKDOWN_FILE,
      "assets/flow.png",
    );
    expect(destination).toBe("../../../assets/flow.png");
    expect(resolveMarkdownImagePath(MARKDOWN_FILE, destination)).toBe(
      "assets/flow.png",
    );
  });

  it("escapes what would break the destination and keeps other letters readable", () => {
    const destination = markdownImageDestination(
      MARKDOWN_FILE,
      "assets/画面 (1)%.png",
    );
    expect(destination).toBe("../../../assets/画面%20%281%29%25.png");
    expect(resolveMarkdownImagePath(MARKDOWN_FILE, destination)).toBe(
      "assets/画面 (1)%.png",
    );
  });
});

describe("markdownImageReference", () => {
  it("uses the file name without its extension as the alt text", () => {
    expect(markdownImageReference(MARKDOWN_FILE, "assets/order-flow.png")).toBe(
      "![order-flow](../../../assets/order-flow.png)",
    );
  });

  it("keeps the whole name of a file without an extension, or one that starts with a dot", () => {
    expect(markdownImageReference(MARKDOWN_FILE, "assets/diagram")).toBe(
      "![diagram](../../../assets/diagram)",
    );
    expect(markdownImageReference(MARKDOWN_FILE, "assets/.png")).toBe(
      "![.png](../../../assets/.png)",
    );
  });

  it("encodes a character outside ASCII that would break the destination", () => {
    // An ideographic space is whitespace: UTF-8 encoded, not kept.
    expect(markdownImageDestination(MARKDOWN_FILE, "assets/a\u3000b.png")).toBe(
      "../../../assets/a%E3%80%80b.png",
    );
  });

  it("escapes brackets in the alt text", () => {
    expect(markdownImageReference(MARKDOWN_FILE, "assets/a[1].png")).toBe(
      "![a\\[1\\]](../../../assets/a%5B1%5D.png)",
    );
  });
});
