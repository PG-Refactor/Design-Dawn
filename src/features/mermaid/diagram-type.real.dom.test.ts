// @vitest-environment jsdom
// Cross-check of src/domain/diagram/diagram-type.ts against the real Mermaid library
// (12.3.0): what the domain calls a type must be what Mermaid itself detects. `mermaid.parse`
// needs no layout, so nothing is faked here. This does not check rendering or any browser.
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { analyzeDiagramSource } from "../../domain/diagram/diagram-source";
import {
  DIAGRAM_KEYWORDS,
  type DiagramType,
  detectDiagramType,
} from "../../domain/diagram/diagram-type";
import { loadMermaidGuiFixtures } from "../../domain/diagram/test-fixtures";

// Mermaid's own diagram ids (the `diagramType` of `mermaid.parse`) as our types. Several
// ids can map to one type (`flowchart-v2`, `flowchart-elk`); `stateDiagram` covers v2.
const MERMAID_ID_TO_TYPE: Readonly<Record<string, DiagramType>> = {
  "flowchart-v2": "flowchart",
  "flowchart-elk": "flowchart",
  sequence: "sequence",
  pie: "pie",
  gantt: "gantt",
  classDiagram: "class",
  stateDiagram: "state",
  er: "er",
  journey: "journey",
  mindmap: "mindmap",
  timeline: "timeline",
  gitGraph: "gitGraph",
  quadrantChart: "quadrantChart",
  xychart: "xychart",
  sankey: "sankey",
  requirement: "requirement",
  c4: "c4",
  block: "block",
  architecture: "architecture",
  kanban: "kanban",
  packet: "packet",
  radar: "radar",
  treemap: "treemap",
  info: "info",
  agentflow: "agentflow",
  swimlane: "swimlane",
  treeView: "treeView",
  eventmodeling: "eventmodeling",
  ishikawa: "ishikawa",
  venn: "venn",
  usecase: "usecase",
  wardley: "wardley",
  cynefin: "cynefin",
  railroad: "railroad",
};

// The smallest body each keyword's grammar accepts in 12.3.0. A bare keyword is not enough
// for several grammars, and a keyword Mermaid's grammar rejects must not be in the table.
const MINIMAL_BODY: Readonly<Record<string, string>> = {
  "flowchart-elk": " TD\nA-->B",
  flowchart: " TD\nA-->B",
  graph: " TD\nA-->B",
  classDiagram: "\nclass A",
  "classDiagram-v2": "\nclass A",
  sankey: "\na,b,1",
  "sankey-beta": "\na,b,1",
  block: "\ncolumns 1\na",
  "block-beta": "\ncolumns 1\na",
  C4Context: "\ntitle T",
  C4Container: "\ntitle T",
  C4Component: "\ntitle T",
  C4Dynamic: "\ntitle T",
  C4Deployment: "\ntitle T",
  packet: '\n0-7: "a"',
  "packet-beta": '\n0-7: "a"',
  "usecase-beta": "\nactor a",
  "wardley-beta": "\ntitle x",
  "railroad-beta": "\ntitle x",
  ishikawa: "\nroot",
  "ishikawa-beta": "\nroot",
  treemap: '\n"a": 1',
  "treemap-beta": '\n"a": 1',
  "venn-beta": "\nset A",
  "cynefin-beta": "\ntitle x",
  kanban: "\n  a[A]",
  "treeView-beta": '\n"a"',
  requirementDiagram: "",
};

async function mermaidDiagramType(source: string): Promise<string | null> {
  try {
    const result = await mermaid.parse(source);
    return result.diagramType;
  } catch {
    return null;
  }
}

describe("diagram keywords against Mermaid 12.3.0", () => {
  it.each(
    DIAGRAM_KEYWORDS.map((entry) => [entry.keyword, entry.type] as const),
  )("%s is accepted by Mermaid as %s", async (keyword, type) => {
    const source = `${keyword}${MINIMAL_BODY[keyword] ?? ""}\n`;
    const mermaidId = await mermaidDiagramType(source);
    expect(mermaidId, source).not.toBeNull();
    expect(MERMAID_ID_TO_TYPE[mermaidId ?? ""]).toBe(type);
    expect(detectDiagramType(source)).toMatchObject({ kind: "known", type });
  });

  it("rejects what Mermaid does not recognise", async () => {
    for (const source of ["hello world\n", "graphviz TD\n", ""]) {
      expect(await mermaidDiagramType(source)).toBeNull();
      expect(detectDiagramType(source).kind).not.toBe("known");
    }
  });
});

describe("the mermaid-gui fixtures against Mermaid 12.3.0", () => {
  const fixtures = loadMermaidGuiFixtures();

  it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
    "%s: detection agrees with Mermaid and nothing is falsely editable",
    async (_id, fixture) => {
      const mermaidId = await mermaidDiagramType(fixture.source);
      expect(mermaidId !== null, "mermaid.parse").toBe(fixture.mermaidParses);
      if (mermaidId !== null) {
        expect(MERMAID_ID_TO_TYPE[mermaidId]).toBe(fixture.diagram);
      }
      const analysis = analyzeDiagramSource(fixture.source);
      // Detection is about the header only, so it may know the type of a source whose
      // body Mermaid rejects; an editor (pie, flowchart, sequence, gantt) must refuse sources Mermaid rejects,
      // and a type without an editor is never editable.
      expect(analysis.detection).toMatchObject({
        kind: "known",
        type: fixture.diagram,
      });
      if (
        fixture.diagram === "pie" ||
        fixture.diagram === "flowchart" ||
        fixture.diagram === "sequence" ||
        fixture.diagram === "gantt"
      ) {
        if (analysis.editability.editable) {
          expect(fixture.mermaidParses).toBe(true);
        }
      } else {
        expect(analysis.editability.editable).toBe(false);
      }
    },
  );
});
