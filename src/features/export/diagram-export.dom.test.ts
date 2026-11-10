// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { MermaidRenderer } from "../mermaid/mermaid-renderer-types";
import { openedActionsHarness } from "../workspace/test-support/actions-harness";
import { exportThemeValues, svgFileText } from "./diagram-export";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 120px" viewBox="0 0 120 80"><rect width="10" height="10"/></svg>';

const renderer: MermaidRenderer = {
  render: () => Promise.resolve({ ok: true, svg: SVG }),
};

describe("svgFileText", () => {
  it("sizes the SVG from its viewBox and adds an XML declaration", () => {
    const file = svgFileText(SVG);
    expect(file?.width).toBe(120);
    expect(file?.height).toBe(80);
    expect(file?.text.startsWith('<?xml version="1.0"')).toBe(true);
    expect(file?.text).toContain('width="120"');
    expect(file?.text).not.toContain("max-width");
  });

  it("refuses an SVG without a size", () => {
    expect(svgFileText('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBeNull();
  });
});

describe("exportThemeValues", () => {
  it("reads the light theme and puts the page's theme back", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    exportThemeValues(document.documentElement);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("exportDiagram", () => {
  it("hands Rust the SVG file under the caption's name", async () => {
    const harness = await openedActionsHarness();
    const result = await harness.services.exportActions.exportDiagram({
      renderer,
      source: "graph TD",
      kind: "svg",
      name: "Order flow",
    });
    expect(result).toEqual({
      ok: true,
      value: { status: "saved", fileName: "Order flow.svg" },
    });
    expect(harness.gateway.methods("exportFile")).toHaveLength(1);
  });

  it("reports a diagram that does not render", async () => {
    const harness = await openedActionsHarness();
    const result = await harness.services.exportActions.exportDiagram({
      renderer: {
        render: () => Promise.resolve({ ok: false, message: "bad" }),
      },
      source: "nope",
      kind: "png",
      name: "",
    });
    expect(!result.ok && result.error.kind).toBe("exportFailed");
    expect(harness.gateway.methods("exportFile")).toHaveLength(0);
  });
});
