// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "./markdown-preview";
import { renderMarkdown } from "./render-markdown";

afterEach(cleanup);

describe("MarkdownPreview", () => {
  it("is a named region showing the sanitised HTML", () => {
    render(
      <MarkdownPreview html={renderMarkdown("# Hello")} label="Preview" />,
    );
    const region = screen.getByRole("region", { name: "Preview" });
    expect(region.querySelector("h1")?.textContent).toBe("Hello");
  });

  it("only accepts SanitizedHtml", () => {
    // @ts-expect-error a plain string is not SanitizedHtml
    const unsafe = <MarkdownPreview html="<b>raw</b>" label="x" />;
    expect(unsafe).toBeTruthy();
  });

  it("never follows a link: click, middle click and Enter are cancelled", () => {
    render(
      <MarkdownPreview
        html={renderMarkdown("[site](https://example.com)")}
        label="Preview"
      />,
    );
    const anchor = screen.getByRole("link", { name: "site" });
    expect(anchor.hasAttribute("target")).toBe(false);
    // fireEvent returns false when the default action was prevented.
    expect(fireEvent.click(anchor)).toBe(false);
    expect(fireEvent.mouseUp(anchor, { button: 1 })).toBe(true);
    expect(
      fireEvent(
        anchor,
        new MouseEvent("auxclick", {
          bubbles: true,
          cancelable: true,
          button: 1,
        }),
      ),
    ).toBe(false);
    expect(fireEvent.keyDown(anchor, { key: "Enter" })).toBe(false);
  });

  it("keeps links out of the Tab order, also after the content changes", () => {
    const { rerender } = render(
      <MarkdownPreview
        html={renderMarkdown("[a](https://a.example)")}
        label="P"
      />,
    );
    expect(screen.getByRole("link", { name: "a" }).tabIndex).toBe(-1);
    rerender(
      <MarkdownPreview
        html={renderMarkdown("[b](https://b.example)")}
        label="P"
      />,
    );
    expect(screen.getByRole("link", { name: "b" }).tabIndex).toBe(-1);
  });

  it("only scrolls when asked to", () => {
    const { rerender } = render(
      <MarkdownPreview html={renderMarkdown("x")} label="P" />,
    );
    expect(screen.getByRole("region").className).not.toContain("scrollable");
    rerender(
      <MarkdownPreview html={renderMarkdown("x")} label="P" scrollable />,
    );
    expect(screen.getByRole("region").className).toContain("scrollable");
  });
});
