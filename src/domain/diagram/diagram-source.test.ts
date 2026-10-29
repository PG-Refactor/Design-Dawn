import { describe, expect, it } from "vitest";
import { analyzeDiagramSource, DIAGRAM_EDITORS } from "./diagram-source";
import { DIAGRAM_KEYWORDS } from "./diagram-type";
import { loadMermaidGuiFixtures } from "./test-fixtures";

describe("analyzeDiagramSource", () => {
  it("has the pie and flowchart editors registered and no other", () => {
    expect(Object.keys(DIAGRAM_EDITORS)).toEqual(["pie", "flowchart"]);
  });

  it("is not editable for an empty source", () => {
    const analysis = analyzeDiagramSource("");
    expect(analysis.detection.kind).toBe("empty");
    expect(analysis.editability).toEqual({ editable: false, reason: "empty" });
    expect(analysis.unsupported).toEqual([]);
  });

  it("is not editable for an unknown type", () => {
    expect(analyzeDiagramSource("hello\nworld").editability).toEqual({
      editable: false,
      reason: "unknownType",
    });
    expect(analyzeDiagramSource("%%{init: {\npie").editability).toEqual({
      editable: false,
      reason: "unknownType",
    });
  });

  it("reports an unterminated front matter on its own", () => {
    expect(analyzeDiagramSource("---\ntitle: T\npie").editability).toEqual({
      editable: false,
      reason: "invalidFrontMatter",
    });
  });

  it("keeps detection and editability separate for every known type", () => {
    for (const { keyword, type } of DIAGRAM_KEYWORDS) {
      const analysis = analyzeDiagramSource(`${keyword}\n  x`);
      expect(analysis.detection.kind).toBe("known");
      expect(analysis.detection).toMatchObject({ type });
      if (type === "pie") {
        expect(analysis.editability).toMatchObject({
          editable: false,
          reason: "editorRefused",
        });
      } else if (type === "flowchart") {
        // The keyword alone may be a header the flowchart editor refuses (e.g. an
        // unsupported variant); either way the editor, not the common layer, decides.
        expect(
          analysis.editability.editable === true ||
            analysis.editability.reason === "editorRefused",
        ).toBe(true);
      } else {
        expect(analysis.editability).toEqual({
          editable: false,
          reason: "noEditorForType",
        });
      }
    }
  });

  it("reports a flowchart as editable, or with the editor's own reason", () => {
    const editable = analyzeDiagramSource("flowchart LR\n  A --> B\n");
    expect(editable.editability).toEqual({
      editable: true,
      type: "flowchart",
    });
    expect(editable.unsupported).toEqual([]);

    const refused = analyzeDiagramSource("flowchart LR\n  A --> B\n  ???\n");
    expect(refused.editability).toMatchObject({
      editable: false,
      reason: "editorRefused",
    });
    expect(
      refused.editability.editable === false && refused.editability.detail,
    ).toContain("unsupportedStatements");
    expect(refused.unsupported.map((line) => line.index)).toEqual([2]);
  });

  it("reports a pie chart as editable, or with the editor's own reason", () => {
    const editable = analyzeDiagramSource('pie\n  "A" : 1\n');
    expect(editable.editability).toEqual({ editable: true, type: "pie" });
    // The editor claims every line it understands.
    expect(editable.unsupported).toEqual([]);

    const refused = analyzeDiagramSource('pie\n  "A" : 1\n  oops\n');
    expect(refused.editability).toEqual({
      editable: false,
      reason: "editorRefused",
      detail: "unsupportedLines: line 3 (unknownStatement)",
    });
    expect(refused.unsupported.map((line) => line.index)).toEqual([2]);

    const duplicate = analyzeDiagramSource('pie\n  "A" : 1\n  "A" : 2\n');
    expect(duplicate.editability).toMatchObject({
      editable: false,
      reason: "editorRefused",
    });
    expect(duplicate.unsupported).toEqual([]);
  });

  it("reports every statement line after the header as unsupported", () => {
    const source = '%% c\ngantt\n  "A" : 1\n\n  "B" : 2\r\n';
    const analysis = analyzeDiagramSource(source);
    expect(analysis.unsupported.map((line) => line.index)).toEqual([2, 4]);
    for (const line of analysis.unsupported) {
      expect(source.slice(line.start, line.end).trim()).not.toBe("");
    }
    // The header, comments and blanks are never claimed or reported as unsupported.
    expect(analysis.lines.map((line) => line.kind)).toEqual([
      "comment",
      "header",
      "statement",
      "blank",
      "statement",
    ]);
  });

  it("never reports an unsupported line as recognised, for every fixture", () => {
    for (const fixture of loadMermaidGuiFixtures()) {
      const analysis = analyzeDiagramSource(fixture.source);
      const statements = analysis.lines.filter(
        (line) => line.kind === "statement",
      );
      if (fixture.diagram === "pie" || fixture.diagram === "flowchart") {
        // Pie and flowchart have an editor: whatever it calls editable must be a chart Mermaid reads.
        if (analysis.editability.editable) {
          expect(fixture.mermaidParses, fixture.id).toBe(true);
          expect(analysis.unsupported, fixture.id).toEqual([]);
        }
      } else {
        expect(analysis.unsupported.length, fixture.id).toBe(statements.length);
        expect(analysis.editability.editable, fixture.id).toBe(false);
      }
      expect(analysis.source, fixture.id).toBe(fixture.source);
    }
  });
});
