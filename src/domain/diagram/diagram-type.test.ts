import { describe, expect, it } from "vitest";
import {
  DIAGRAM_KEYWORDS,
  type DiagramType,
  detectDiagramType,
} from "./diagram-type";
import { loadMermaidGuiFixtures } from "./test-fixtures";

function typeOf(source: string): DiagramType | string {
  const detection = detectDiagramType(source);
  if (detection.kind === "known") return detection.type;
  return detection.kind === "unknown" ? `unknown:${detection.reason}` : "empty";
}

describe("detectDiagramType", () => {
  it.each(DIAGRAM_KEYWORDS.map((entry) => [entry.keyword, entry.type]))(
    "detects %s as %s",
    (keyword, type) => {
      expect(typeOf(`${keyword}\n`)).toBe(type);
      expect(typeOf(`${keyword} TD\n  x`)).toBe(type);
    },
  );

  it("maps flowchart and graph to one type", () => {
    expect(typeOf("graph LR")).toBe("flowchart");
    expect(typeOf("flowchart LR")).toBe("flowchart");
  });

  it("has no duplicate keyword", () => {
    const keywords = DIAGRAM_KEYWORDS.map((entry) => entry.keyword);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it("matches the case-insensitive keywords only", () => {
    expect(typeOf("Ishikawa-Beta")).toBe("ishikawa");
    expect(typeOf("PIE")).toBe("unknown:unknownKeyword");
  });

  it("skips front matter, blank lines, comments and directives", () => {
    expect(
      typeOf(
        '---\ntitle: T\n---\n\n%% c\n%%{init: {"theme":"forest"}}%%\n  \n  pie showData',
      ),
    ).toBe("pie");
  });

  it("reports the keyword range in the original string", () => {
    const source = "%% c\r\n\t  sequenceDiagram\r\n";
    const detection = detectDiagramType(source);
    if (detection.kind !== "known") throw new Error("expected known");
    expect(source.slice(detection.keywordStart, detection.keywordEnd)).toBe(
      "sequenceDiagram",
    );
    expect(detection.headerLine.index).toBe(1);
    expect(detection.headerLine.terminator).toBe("\r\n");
  });

  it("works with CRLF and a lone CR after the keyword", () => {
    expect(typeOf('pie\r\n  "A" : 1\r\n')).toBe("pie");
    expect(typeOf("pie\r")).toBe("pie");
  });

  it("needs the keyword to be a whole token", () => {
    expect(typeOf("graphX TD")).toBe("unknown:unknownKeyword");
    expect(typeOf("pieChart")).toBe("unknown:unknownKeyword");
    expect(typeOf("flowchartTD")).toBe("unknown:unknownKeyword");
    expect(typeOf("pie showData")).toBe("pie");
    expect(typeOf("graph;")).toBe("unknown:unknownKeyword");
  });

  it("does not match a keyword hidden in a later line", () => {
    expect(typeOf("hello\npie")).toBe("unknown:unknownKeyword");
  });

  it("is unknown for unterminated front matter and directives", () => {
    expect(typeOf("---\ntitle: T\npie\n")).toBe(
      "unknown:unterminatedFrontMatter",
    );
    expect(typeOf('%%{init: {\n"a": 1}\n}%%\npie')).toBe(
      "unknown:multilineDirective",
    );
    expect(typeOf("%%{init: {\npie")).toBe("unknown:unterminatedDirective");
  });

  it("is empty for empty or trivia-only sources", () => {
    expect(typeOf("")).toBe("empty");
    expect(typeOf("  \n\t\r\n")).toBe("empty");
    expect(typeOf("%% only a comment\n%%{init: {}}%%\n")).toBe("empty");
    expect(typeOf("---\na: 1\n---\n")).toBe("empty");
  });

  it("does not trim the source", () => {
    const source = "  \n  pie";
    const detection = detectDiagramType(source);
    if (detection.kind !== "known") throw new Error("expected known");
    expect(detection.keywordStart).toBe(source.indexOf("pie"));
  });

  it("detects the type recorded for every fixture", () => {
    for (const fixture of loadMermaidGuiFixtures()) {
      expect(typeOf(fixture.source), fixture.id).toBe(fixture.diagram);
    }
  });
});
