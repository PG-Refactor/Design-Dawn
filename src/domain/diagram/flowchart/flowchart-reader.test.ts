import { describe, expect, it } from "vitest";
import { flowchartEditability } from "./flowchart-editability";
import { readFlowchart } from "./flowchart-reader";
import {
  FLOWCHART_OPAQUE_REASONS,
  type FlowchartOpaqueReason,
} from "./flowchart-types";

const f = (body: string) => `flowchart TD\n${body}\n`;
const meaningOf = (source: string) => {
  const reading = readFlowchart(source);
  if (reading.meaning === null) {
    throw new Error(
      `no meaning: ${JSON.stringify(reading.opaque)} ${JSON.stringify(reading.sourceIssues)}`,
    );
  }
  return reading.meaning;
};

describe("A: normal flowcharts", () => {
  it("reads the header keyword and direction with spans", () => {
    const reading = readFlowchart("  graph TD;\nA-->B\n");
    expect(reading.isFlowchart).toBe(true);
    expect(reading.header?.keyword).toBe("graph");
    expect(reading.header?.keywordToken).toEqual({
      text: "graph",
      span: { start: 2, end: 7 },
    });
    expect(reading.header?.directionValue).toBe("TD");
    expect(reading.header?.direction).toBe("TB");
    expect(reading.header?.terminator?.text).toBe(";");
  });

  it.each([
    ["flowchart LR", "LR"],
    ["flowchart RL", "RL"],
    ["flowchart BT", "BT"],
    ["flowchart TB", "TB"],
    ["flowchart TD", "TB"],
    ["graph", "TB"],
  ])("direction of %s is %s", (header, direction) => {
    expect(meaningOf(`${header}\nA-->B\n`).direction).toBe(direction);
  });

  it("reads statements after the header's semicolon", () => {
    const reading = readFlowchart("graph TD;A-->B;C\n");
    expect(reading.statements.map((statement) => statement.kind)).toEqual([
      "edge",
      "node",
    ]);
    expect(reading.meaning?.nodes.map((node) => node.id)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("reads all 13 bracket shapes and the ellipse", () => {
    const cases: [string, string][] = [
      ["A[t]", "square"],
      ["A(t)", "round"],
      ["A([t])", "stadium"],
      ["A[[t]]", "subroutine"],
      ["A[(t)]", "cylinder"],
      ["A((t))", "circle"],
      ["A(((t)))", "doublecircle"],
      ["A>t]", "odd"],
      ["A{t}", "diamond"],
      ["A{{t}}", "hexagon"],
      ["A[/t/]", "lean_right"],
      ["A[\\t\\]", "lean_left"],
      ["A[/t\\]", "trapezoid"],
      ["A[\\t/]", "inv_trapezoid"],
      ["A(-t-)", "ellipse"],
    ];
    for (const [text, shape] of cases) {
      const node = meaningOf(f(text)).nodes[0];
      expect(node?.shape, text).toBe(shape);
      expect(node?.text, text).toBe("t");
    }
  });

  it("keeps the spans of a shape and its label", () => {
    const source = f('A["  text  "]');
    const reading = readFlowchart(source);
    const statement = reading.statements[0];
    if (statement?.kind !== "node") throw new Error("expected a node");
    const shape = statement.groups[0]?.terms[0]?.shape;
    expect(shape?.opener.text).toBe("[");
    expect(shape?.closer.text).toBe("]");
    expect(shape?.label.content.text).toBe("  text  ");
    expect(shape?.label.value).toBe("text");
    expect(shape?.label.quoted).toBe(true);
  });

  it("reads quoted, unquoted, Unicode, emoji and markdown labels", () => {
    const meaning = meaningOf(
      f('A[hello world]\nB["a (b) | c"]\nC[日本語]\nD["😀"]\nE["`**md**`"]'),
    );
    expect(meaning.nodes.map((node) => node.text)).toEqual([
      "hello world",
      "a (b) | c",
      "日本語",
      "😀",
      "**md**",
    ]);
    expect(meaning.nodes[4]?.labelType).toBe("markdown");
  });

  it("reads @{} blocks", () => {
    const meaning = meaningOf(
      f(
        'A@{ shape: cyl }\nB@{ shape: doc, label: "R" }\nC@{ label: "t", labelType: text }',
      ),
    );
    expect(
      meaning.nodes.map((node) => [node.shape, node.text, node.labelType]),
    ).toEqual([
      ["cyl", "A", "text"],
      ["doc", "R", "markdown"],
      [null, "t", "text"],
    ]);
    expect(meaning.nodes[0]?.explicitLabel).toBe(false);
    expect(meaning.nodes[1]?.explicitLabel).toBe(true);
  });

  it("reads every link type, stroke and length", () => {
    const cases: [string, string, string, number][] = [
      ["A-->B", "arrow_point", "normal", 1],
      ["A---B", "arrow_open", "normal", 1],
      ["A--->B", "arrow_point", "normal", 2],
      ["A-.->B", "arrow_point", "dotted", 1],
      ["A-..->B", "arrow_point", "dotted", 2],
      ["A==>B", "arrow_point", "thick", 1],
      ["A===B", "arrow_open", "thick", 1],
      ["A--oB", "arrow_circle", "normal", 1],
      ["A--xB", "arrow_cross", "normal", 1],
      ["A<-->B", "double_arrow_point", "normal", 1],
      ["A o--o B", "double_arrow_circle", "normal", 1],
      ["A x--x B", "double_arrow_cross", "normal", 1],
      ["A~~~B", "arrow_open", "invisible", 1],
    ];
    for (const [text, type, stroke, length] of cases) {
      const edge = meaningOf(f(text)).edges[0];
      expect([edge?.type, edge?.stroke, edge?.length], text).toEqual([
        type,
        stroke,
        length,
      ]);
    }
  });

  it("reads edge labels in both forms with their spans", () => {
    const meaning = meaningOf(
      f('A-->|yes|B\nC -- text --> D\nE -->|"q | p"| F'),
    );
    expect(meaning.edges.map((edge) => [edge.text, edge.labelForm])).toEqual([
      ["yes", "pipe"],
      ["text", "inline"],
      ["q | p", "pipe"],
    ]);
    const reading = readFlowchart(f("A-->|yes|B"));
    const statement = reading.statements[0];
    if (statement?.kind !== "edge") throw new Error("expected an edge");
    const label = statement.links[0]?.label;
    expect(label?.open.text).toBe("|");
    expect(label?.label.content.text).toBe("yes");
  });

  it("expands chains and ampersand lists in Mermaid's order", () => {
    const meaning = meaningOf(f("A --> B --> C\nD & E --> F & G"));
    expect(meaning.edges.map((edge) => `${edge.start}>${edge.end}`)).toEqual([
      "A>B",
      "B>C",
      "D>F",
      "D>G",
      "E>F",
      "E>G",
    ]);
    expect(meaning.edges[0]?.sharedByAmpersand).toBe(false);
    expect(meaning.edges[2]?.sharedByAmpersand).toBe(true);
  });

  it("names auto edge ids like Mermaid and keeps user ids", () => {
    const meaning = meaningOf(f("A-->B\nA-->B\nA e1@--> B\nA-.->B"));
    expect(meaning.edges.map((edge) => [edge.id, edge.userDefinedId])).toEqual([
      ["L_A_B_0", false],
      ["L_A_B_2", false],
      ["e1", true],
      ["L_A_B_4", false],
    ]);
  });

  it("gives an ampersand list's edge id to the last start and first end", () => {
    const meaning = meaningOf(f("A & B e1@--> C & D"));
    expect(
      meaning.edges
        .filter((edge) => edge.userDefinedId)
        .map((edge) => `${edge.start}>${edge.end}`),
    ).toEqual(["B>C"]);
  });

  it("applies edge attribute lines", () => {
    const meaning = meaningOf(
      f("A e1@--> B\ne1@{ animate: true, curve: linear, animation: fast }"),
    );
    expect(meaning.edges[0]).toMatchObject({
      animate: true,
      interpolate: "linear",
      animation: "fast",
    });
  });

  it("accepts several statements per line and stray separators at top level", () => {
    const meaning = meaningOf(f(";A-->B;;C;\n\tD  ;  E"));
    expect(meaning.nodes.map((node) => node.id)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });

  it("resolves subgraphs: nesting, titles, direction, first definition wins", () => {
    const meaning = meaningOf(
      f(
        'subgraph O ["Outer"]\n  direction LR\n  subgraph I\n    A-->B\n  end\n  C\nend\nsubgraph P\n  B-->D\nend',
      ),
    );
    expect(meaning.subgraphs.map((subgraph) => subgraph.id)).toEqual([
      "I",
      "O",
      "P",
    ]);
    const [inner, outer, second] = meaning.subgraphs;
    expect(inner?.members).toEqual(["A", "B"]);
    expect(outer?.members).toEqual(["I", "C"]);
    expect(outer?.title).toBe("Outer");
    expect(outer?.direction).toBe("LR");
    expect(second?.members).toEqual(["D"]);
  });

  it("identifies implicit nodes", () => {
    const meaning = meaningOf(f("A-->B[Label]\nC\nstyle D fill:#f00"));
    const byId = Object.fromEntries(
      meaning.nodes.map((node) => [node.id, node]),
    );
    expect(byId.A).toMatchObject({ explicitLabel: false, shape: null });
    expect(byId.A?.firstMention.origin).toBe("edgeEndpoint");
    expect(byId.B).toMatchObject({ explicitLabel: true });
    expect(byId.B?.firstMention.origin).toBe("definition");
    expect(byId.C?.firstMention.origin).toBe("bareNode");
    expect(byId.D?.firstMention.origin).toBe("styleStatement");
  });

  it("replays classDef, class, style, click and linkStyle", () => {
    const meaning = meaningOf(
      f(
        'A:::k --> B\nclassDef k fill:#f00,stroke:#333\nclassDef k stroke-width:2px\nclass B k\nclass Z k\nstyle A fill:#bbf\nclick A "https://example.com" "tip"\nlinkStyle 0 stroke:red\nlinkStyle default interpolate basis\nC-->D',
      ),
    );
    expect(meaning.classDefs).toEqual([
      { name: "k", styles: ["fill:#f00", "stroke:#333", "stroke-width:2px"] },
    ]);
    const [a, b] = meaning.nodes;
    expect(a).toMatchObject({
      classes: ["k", "clickable"],
      hasLink: true,
      hasTooltip: true,
    });
    expect(b?.classes).toEqual(["k"]);
    expect(meaning.nodes.some((node) => node.id === "Z")).toBe(false);
    expect(meaning.edges[0]?.style).toEqual(["stroke:red", "fill:none"]);
    expect(meaning.edges[1]?.interpolate).toBe("basis");
    expect(meaning.edgeDefaults.interpolate).toBe("basis");
  });
});

describe("B: recognised statements that do not block", () => {
  it("keeps the diagram editable with classDef, class, style, linkStyle, click, acc and edge ids", () => {
    const source = f(
      'A e1@--> B\ne1@{ animate: true }\nclassDef k fill:#f00\nclass A k\nstyle B fill:#bbf\nlinkStyle 0 stroke:red\nclick A "https://example.com"\naccTitle: T\naccDescr: D\nC["`md`"]',
    );
    const reading = readFlowchart(source);
    expect(reading.opaque).toEqual([]);
    expect(flowchartEditability(reading)).toEqual({ editable: true });
    expect(
      reading.meaning?.nodes.find((node) => node.id === "C")?.labelType,
    ).toBe("markdown");
  });

  it("reads the ellipse, but a diagram with one is not editable (Mermaid cannot draw it)", () => {
    const reading = readFlowchart(f("A(-x-)"));
    expect(reading.opaque).toEqual([]);
    expect(reading.meaning?.nodes[0]?.shape).toBe("ellipse");
    expect(flowchartEditability(reading)).toMatchObject({
      editable: false,
      reason: "undrawableShape",
    });
    // A later definition with a drawable shape wins, as in Mermaid.
    expect(flowchartEditability(readFlowchart(f("A(-x-)\nA[x]")))).toEqual({
      editable: true,
    });
  });
});

const OPAQUE_SAMPLES: Readonly<Record<FlowchartOpaqueReason, string>> = {
  unsupportedHeader: "graph >\nA-->B",
  topLevelDirection: f("direction LR"),
  unsupportedDirection: f("subgraph S\ndirection XX\nend"),
  unsupportedSubgraphHeader: f('subgraph "t"\nend'),
  subgraphSharesLine: f("subgraph S; A; end"),
  duplicateSubgraphId: f("subgraph S\nend\nsubgraph S\nend"),
  unclosedSubgraph: f("subgraph S\nA"),
  endWithoutSubgraph: f("end"),
  duplicateSubgraphDirection: f("subgraph S\ndirection LR\ndirection TB\nend"),
  strayStatementSeparator: f("subgraph S\n;A\nend"),
  unterminatedQuote: f('A["x'),
  unterminatedBracket: f("A[x"),
  unterminatedAtBlock: f("A@{ shape: cyl"),
  backtickInLabel: f("A[`x`]"),
  specialCharsInLabel: f("A[a (b)]"),
  emptyLabel: f("A[]"),
  propsShape: f("A[|k:v|t]"),
  keywordLikeId: f("end-x-->B"),
  reservedId: f("default-->B"),
  unsupportedId: f("A:B-->C"),
  ambiguousLinkBoundary: f("x-->B"),
  entityLikeText: f("A-->B#amp;"),
  invalidLink: f("A B"),
  invalidEdgeLabel: f("A-->|x B"),
  mismatchedInlineLink: f("A <-- t --o B"),
  atBlockUnsupportedKey: f('A@{ icon: "x" }'),
  atBlockEscape: f('A@{ label: "a\\nb" }'),
  atBlockDuplicateKey: f("A@{ shape: cyl, shape: doc }"),
  atBlockUnsupportedValue: f("A@{ label: x y }"),
  atBlockMalformed: f("A@{ }"),
  atBlockOnSubgraph: f('subgraph S\nA\nend\nS@{ label: "x" }'),
  atBlockBeforeEdgeId: f("A@{ shape: cyl } e1@--> B"),
  unknownShape: f("A@{ shape: nope }"),
  edgeIdSwallowsNode: f('A e1@--> B\ne1["X"]'),
  unsupportedClassDef: f("classDef k"),
  unsupportedClass: f("A\nclass A a,b"),
  unsupportedStyle: f("A\nstyle A,B fill:red"),
  unsupportedLinkStyle: f("A-->B\nlinkStyle 0"),
  linkStyleOutOfRange: f("A-->B\nlinkStyle 1 stroke:red"),
  unsupportedClick: f('A\nclick A ""'),
  unsupportedAccessibility: f("accTitle: a;b"),
  bareCommentMark: f("%%\nA"),
  nonAsciiWhitespace: "flowchart TD\nA-->B \n",
  unrecognizedStatement: f("A:::"),
};

describe("C: opaque statements", () => {
  it("has a sample for every reason", () => {
    expect(Object.keys(OPAQUE_SAMPLES).sort()).toEqual(
      [...FLOWCHART_OPAQUE_REASONS].sort(),
    );
  });

  it.each(FLOWCHART_OPAQUE_REASONS.map((reason) => [reason] as const))(
    "reports %s",
    (reason) => {
      const reading = readFlowchart(OPAQUE_SAMPLES[reason]);
      expect(reading.opaque.map((entry) => entry.reason)).toContain(reason);
      expect(reading.meaning).toBeNull();
      const editability = flowchartEditability(reading);
      expect(editability.editable).toBe(false);
    },
  );

  it("gives an opaque statement its line, span and text", () => {
    const source = "flowchart TD\nA-->B\n  C[x\n";
    const [entry] = readFlowchart(source).opaque;
    expect(entry?.lineIndex).toBe(2);
    expect(source.slice(entry?.span.start, entry?.span.end)).toBe(entry?.text);
    expect(entry?.text).toBe("C[x");
  });

  it("does not read a non-flowchart", () => {
    const reading = readFlowchart('pie\n  "A" : 1\n');
    expect(reading.isFlowchart).toBe(false);
    expect(reading.statements).toEqual([]);
    expect(reading.meaning).toBeNull();
  });

  it("flags text Mermaid rewrites before parsing", () => {
    expect(readFlowchart("flowchart TD\rA-->B\r").sourceIssues[0]?.code).toBe(
      "loneCarriageReturn",
    );
    expect(readFlowchart(f('%% <a href="x">\nA')).sourceIssues[0]?.code).toBe(
      "markupRewrite",
    );
    expect(readFlowchart(f('A["style x:#a; y"]')).sourceIssues[0]?.code).toBe(
      "styleLikeText",
    );
    expect(readFlowchart(f("A-->B %%{init: {}}%%")).sourceIssues[0]?.code).toBe(
      "inlineDirective",
    );
    expect(readFlowchart(f("style A fill:#f00;\nA")).sourceIssues).toEqual([]);
  });
});

function collectSpanned(
  value: unknown,
  found: { text: string; span: { start: number; end: number } }[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSpanned(item, found);
  } else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const span = record.span as { start?: unknown; end?: unknown } | undefined;
    if (
      span !== undefined &&
      typeof span.start === "number" &&
      typeof record.text === "string"
    ) {
      found.push({
        text: record.text,
        span: span as { start: number; end: number },
      });
    }
    for (const child of Object.values(record)) collectSpanned(child, found);
  }
}

const INVARIANT_SOURCES = [
  f(
    'A[ "x y" ] --> B{{t}}\nsubgraph S ["T"]\n  C -->|l| D\nend\nclassDef k fill:#f00\nA e1@--> B\ne1@{ animate: true }',
  ),
  'flowchart TD;A-->B;C\r\n  D -- t --> E\r\n%% c\r\nclick A "https://x.y" "t"',
  'graph LR\n\tA@{ shape: cyl, label: "日本語😀" } & B --> C\nlinkStyle 0 stroke:red',
  "flowchart TD\nA[x\nB-->",
];

describe("D: invariants", () => {
  it.each(INVARIANT_SOURCES.map((source, index) => [index, source] as const))(
    "source %i: lines rebuild the text, spans slice to their text, reading is pure",
    (_index, source) => {
      const reading = readFlowchart(source);
      expect(reading.source).toBe(source);
      expect(
        reading.lines.map((line) => line.text + line.terminator).join(""),
      ).toBe(source);
      const found: { text: string; span: { start: number; end: number } }[] =
        [];
      collectSpanned(
        [reading.header, reading.statements, reading.opaque],
        found,
      );
      expect(found.length).toBeGreaterThan(0);
      for (const entry of found) {
        expect(source.slice(entry.span.start, entry.span.end)).toBe(entry.text);
      }
      expect(readFlowchart(source)).toEqual(reading);
      if (reading.opaque.length > 0) expect(reading.meaning).toBeNull();
    },
  );

  it("never returns a partial meaning", () => {
    const reading = readFlowchart(f("A-->B\nC[x"));
    expect(reading.opaque.length).toBeGreaterThan(0);
    expect(reading.meaning).toBeNull();
  });

  it("returns an empty reading for the empty source", () => {
    const reading = readFlowchart("");
    expect(reading.isFlowchart).toBe(false);
    expect(reading.lines).toEqual([]);
    expect(reading.meaning).toBeNull();
  });
});
