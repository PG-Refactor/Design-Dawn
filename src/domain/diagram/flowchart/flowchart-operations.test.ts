import { describe, expect, it } from "vitest";
import { applyTextEdits, type TextEdit } from "../text-edit";
import {
  type FlowchartOperation,
  planFlowchartOperation,
  verifyFlowchartCandidate,
} from "./flowchart-operations";
import { readFlowchart } from "./flowchart-reader";

const R1 =
  "flowchart TD\n    A[Start] --> B{Check}\n    B -->|yes| C[Done]\n    B -->|no| D[Retry]\n    D --> A\n";
const R2 = `flowchart LR
    classDef hot fill:#f96,stroke:#333
    subgraph Front [Frontend]
        direction TB
        UI[UI] --> API
    end
    subgraph Back
        API[API] --> DB[(DB)]
    end
    UI:::hot
    API -.-> Cache
    Cache ==> DB
    style DB fill:#bbf
    linkStyle 0 stroke:#f00
    linkStyle 2 stroke:#0a0,stroke-width:3px
    click UI "https://example.com" "tip"
    class Cache hot
`;
const R3 = `flowchart TD
    A --> B --> C
    D & E --> F & G
    H -->|x| I -.-> J
    linkStyle 5,7 stroke:#f00
`;
const R4 = `flowchart TD
    A@{ shape: cyl, label: "Store" }
    B@{ shape: doc, label: "Report" }
    A e1@--> B
    B e2@==> C
    e1@{ animate: true }
    e2@{ curve: linear }
`;
const R5 = "flowchart TD\n    A --> B\n    B --> C\n    C --> D\n";
const R8 = `flowchart TD
    A[Start] --> B{Check}
    B -->|yes| C[Done]
    B -- maybe --> D[Retry]
    D e1@==> A
    E & F --> G
`;

// Inverse of a set of edits, in the coordinates of the result. Adjacent deletions invert to
// several insertions at one offset, which applyTextEdits refuses as ambiguous, so they are
// merged into one.
function invert(source: string, edits: readonly TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let delta = 0;
  const inverse: TextEdit[] = [];
  for (const edit of sorted) {
    const start = edit.start + delta;
    inverse.push({
      start,
      end: start + edit.text.length,
      text: source.slice(edit.start, edit.end),
    });
    delta += edit.text.length - (edit.end - edit.start);
  }
  const merged: TextEdit[] = [];
  for (const edit of inverse) {
    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      last.start === last.end &&
      edit.start === edit.end &&
      last.start === edit.start
    ) {
      merged[merged.length - 1] = { ...last, text: last.text + edit.text };
    } else {
      merged.push(edit);
    }
  }
  return merged;
}

// Runs an operation the way the application does and proves the result: the edits apply, the
// candidate reads as exactly the promised meaning, and the inverse edits restore the source.
function run(source: string, operation: FlowchartOperation): string {
  const plan = planFlowchartOperation(source, operation);
  if (!plan.ok) {
    throw new Error(`refused: ${plan.error.kind} ${plan.error.detail}`);
  }
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(`edits: ${applied.error.detail}`);
  expect(
    verifyFlowchartCandidate(applied.value.text, plan.value.expected),
  ).toEqual({ ok: true, value: undefined });
  expect(applied.value.changed).toBe(plan.value.edits.length > 0);
  const restored = applyTextEdits(
    applied.value.text,
    invert(source, plan.value.edits),
  );
  expect(restored.ok && restored.value.text).toBe(source);
  return applied.value.text;
}

function refusal(source: string, operation: FlowchartOperation) {
  const plan = planFlowchartOperation(source, operation);
  if (plan.ok) throw new Error("expected a refusal");
  return plan.error;
}

const reasonOf = (error: { readonly detail: string }): string =>
  error.detail.split(":")[0] as string;

const edge = (index: number, id: string) => ({ index, id });

describe("a diagram the editor may not touch", () => {
  it("is refused as not editable, naming the reason", () => {
    const error = refusal("flowchart TD\n    A[x --> B\n", {
      kind: "setDirection",
      direction: "LR",
    });
    expect(error.kind).toBe("diagramNotEditable");
    expect(reasonOf(error)).toBe("unsupportedStatements");
  });
});

describe("setDirection", () => {
  it("replaces the direction token and nothing else", () => {
    expect(run(R1, { kind: "setDirection", direction: "LR" })).toBe(
      R1.replace("TD", "LR"),
    );
  });

  it("writes TD for top-to-bottom and leaves TD alone when it already is", () => {
    expect(
      run("flowchart LR\n    A --> B\n", {
        kind: "setDirection",
        direction: "TB",
      }),
    ).toBe("flowchart TD\n    A --> B\n");
    expect(run(R1, { kind: "setDirection", direction: "TB" })).toBe(R1);
    expect(
      run("graph TB\n    A --> B\n", { kind: "setDirection", direction: "TB" }),
    ).toBe("graph TB\n    A --> B\n");
  });

  it("adds a direction to a header that has none, and keeps a header semicolon", () => {
    expect(
      run("graph\n    A --> B\n", { kind: "setDirection", direction: "RL" }),
    ).toBe("graph RL\n    A --> B\n");
    expect(
      run("flowchart TD; A --> B\n", { kind: "setDirection", direction: "BT" }),
    ).toBe("flowchart BT; A --> B\n");
  });

  it("does nothing when the default direction is asked for on a bare header", () => {
    const plan = planFlowchartOperation("graph\n    A --> B\n", {
      kind: "setDirection",
      direction: "TB",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
  });

  it("keeps CRLF line endings", () => {
    const crlf = R1.replace(/\n/g, "\r\n");
    expect(run(crlf, { kind: "setDirection", direction: "RL" })).toBe(
      crlf.replace("TD", "RL"),
    );
  });
});

describe("setNodeLabel", () => {
  it("replaces the text between the quotes of a quoted label", () => {
    const source = 'flowchart TD\n    A["Start"] --> B\n';
    expect(
      run(source, { kind: "setNodeLabel", nodeId: "A", label: "Begin" }),
    ).toBe('flowchart TD\n    A["Begin"] --> B\n');
  });

  it("quotes an unquoted label", () => {
    expect(run(R1, { kind: "setNodeLabel", nodeId: "A", label: "Begin" })).toBe(
      R1.replace("[Start]", '["Begin"]'),
    );
  });

  it("replaces the blanks around an unquoted label too, so the quote touches the bracket", () => {
    expect(
      run("flowchart TD\n    A[ Start ] --> B\n", {
        kind: "setNodeLabel",
        nodeId: "A",
        label: "Begin",
      }),
    ).toBe('flowchart TD\n    A["Begin"] --> B\n');
  });

  it("gives an implicit node a label after its first mention, and a rectangle shape", () => {
    expect(run(R5, { kind: "setNodeLabel", nodeId: "B", label: "Bee" })).toBe(
      R5.replace("A --> B", 'A --> B["Bee"]'),
    );
  });

  it("puts the label of an implicit node with a class operator before the operator", () => {
    const source = "flowchart TD\n    classDef c fill:#f00\n    A:::c --> B\n";
    expect(
      run(source, { kind: "setNodeLabel", nodeId: "A", label: "Hot" }),
    ).toBe('flowchart TD\n    classDef c fill:#f00\n    A["Hot"]:::c --> B\n');
  });

  it("labels the first mention when the node is mentioned several times", () => {
    const source = "flowchart TD\n    A --> B\n    B --> A\n";
    expect(
      run(source, { kind: "setNodeLabel", nodeId: "A", label: "Alpha" }),
    ).toBe('flowchart TD\n    A["Alpha"] --> B\n    B --> A\n');
  });

  it("edits the definition even when other mentions are bare", () => {
    expect(run(R1, { kind: "setNodeLabel", nodeId: "D", label: "Again" })).toBe(
      R1.replace("D[Retry]", 'D["Again"]'),
    );
  });

  it("works inside a subgraph with style, class and click statements around", () => {
    const result = run(R2, {
      kind: "setNodeLabel",
      nodeId: "UI",
      label: "Interface",
    });
    expect(result).toBe(R2.replace("UI[UI]", 'UI["Interface"]'));
  });

  it("does nothing when the label is already the text", () => {
    const plan = planFlowchartOperation(R1, {
      kind: "setNodeLabel",
      nodeId: "A",
      label: "Start",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
  });

  const ENCODINGS: readonly (readonly [string, string])[] = [
    ["Begin (v2)", "Begin (v2)"],
    ["a<b", "a#lt;b"],
    ["a>b", "a#gt;b"],
    ["<b>", "#lt;b#gt;"],
    ["line one\nline two", "line one<br/>line two"],
    ["a;b", "a;b"],
    ["a|b", "a|b"],
    ["[x] {y} (z)", "[x] {y} (z)"],
    ["a --> b", "a --#gt; b"],
    ["a  b", "a  b"],
    ["日本語 🐶", "日本語 🐶"],
    ["50% off #1", "50% off #1"],
    ["a & b", "a & b"],
    ["it's", "it's"],
  ];
  it.each(ENCODINGS)("writes %j as %j", (label, written) => {
    const result = run(R1, { kind: "setNodeLabel", nodeId: "A", label });
    expect(result).toBe(R1.replace("[Start]", `["${written}"]`));
  });

  const REFUSED_LABELS: readonly (readonly [string, string])[] = [
    ["", "emptyLabel"],
    ["   ", "emptyLabel"],
    [" padded", "labelNotTrimmed"],
    ["padded\n", "labelNotTrimmed"],
    ['say "hi"', "doubleQuote"],
    ["a\tb", "controlCharacter"],
    ["a\rb", "controlCharacter"],
    ["a\u0085b", "controlCharacter"],
    ["a b", "controlCharacter"],
    ["a`b", "backtick"],
    ["a\\b", "backslash"],
    ["%%{init: {}}%%", "directive"],
    ["see #35;", "entityLikeText"],
    ["#lt;", "entityLikeText"],
    ["a &amp; b", "entityLikeText"],
    ["&#35;", "entityLikeText"],
  ];
  it.each(REFUSED_LABELS)("refuses %j (%s)", (label, reason) => {
    const error = refusal(R1, { kind: "setNodeLabel", nodeId: "A", label });
    expect(error.kind).toBe("invalidDiagramOperation");
    expect(reasonOf(error)).toBe(reason);
  });

  it("refuses a node that does not exist", () => {
    expect(
      reasonOf(refusal(R1, { kind: "setNodeLabel", nodeId: "Z", label: "x" })),
    ).toBe("targetNotFound");
  });

  it("refuses a node defined with @{}, a node defined twice, and a markdown label", () => {
    expect(
      reasonOf(refusal(R4, { kind: "setNodeLabel", nodeId: "A", label: "x" })),
    ).toBe("atBlockNode");
    expect(
      reasonOf(
        refusal("flowchart TD\n    A[One]\n    A[Two]\n    A --> B\n", {
          kind: "setNodeLabel",
          nodeId: "A",
          label: "x",
        }),
      ),
    ).toBe("multipleDefinitions");
    expect(
      reasonOf(
        refusal('flowchart TD\n    A["`**bold**`"] --> B\n', {
          kind: "setNodeLabel",
          nodeId: "A",
          label: "x",
        }),
      ),
    ).toBe("markdownLabel");
  });

  it("refuses a node that only a style statement creates", () => {
    expect(
      reasonOf(
        refusal("flowchart TD\n    A --> B\n    style Z fill:#f00\n", {
          kind: "setNodeLabel",
          nodeId: "Z",
          label: "x",
        }),
      ),
    ).toBe("nodeNotWritten");
  });

  it("refuses to bring back a node that Mermaid draws without a shape", () => {
    // An ellipse node makes the whole diagram not editable.
    const error = refusal("flowchart TD\n    A(-x-) --> B\n", {
      kind: "setNodeLabel",
      nodeId: "B",
      label: "y",
    });
    expect(error.kind).toBe("diagramNotEditable");
  });
});

describe("setNodeShape", () => {
  it("replaces the brackets of a quoted label", () => {
    const source = 'flowchart TD\n    A["Start"] --> B\n';
    expect(
      run(source, { kind: "setNodeShape", nodeId: "A", shape: "circle" }),
    ).toBe('flowchart TD\n    A(("Start")) --> B\n');
  });

  it("quotes an unquoted label while it changes the brackets", () => {
    expect(run(R1, { kind: "setNodeShape", nodeId: "B", shape: "round" })).toBe(
      R1.replace("{Check}", '("Check")'),
    );
  });

  it("quotes a label with a slash before it goes between lean brackets", () => {
    expect(
      run("flowchart TD\n    A[x/y] --> B\n", {
        kind: "setNodeShape",
        nodeId: "A",
        shape: "lean_right",
      }),
    ).toBe('flowchart TD\n    A[/"x/y"/] --> B\n');
  });

  it("writes the brackets of an implicit node, spelling out its id as the label", () => {
    expect(
      run(R5, { kind: "setNodeShape", nodeId: "A", shape: "diamond" }),
    ).toBe(R5.replace("A --> B", 'A{"A"} --> B'));
  });

  it("does nothing when the node already has the shape", () => {
    const plan = planFlowchartOperation(R1, {
      kind: "setNodeShape",
      nodeId: "A",
      shape: "square",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
  });

  it("changes a node inside a subgraph that has style and linkStyle lines", () => {
    expect(
      run(R2, { kind: "setNodeShape", nodeId: "DB", shape: "diamond" }),
    ).toBe(R2.replace("DB[(DB)]", 'DB{"DB"}'));
  });

  it("writes every shape the editor offers and reads each back as that shape", () => {
    const shapes = [
      "square",
      "round",
      "stadium",
      "subroutine",
      "cylinder",
      "circle",
      "doublecircle",
      "odd",
      "diamond",
      "hexagon",
      "lean_right",
      "lean_left",
      "trapezoid",
      "inv_trapezoid",
    ] as const;
    for (const shape of shapes) {
      const result = run(R1, {
        kind: "setNodeShape",
        nodeId: "C",
        shape: shape === "square" ? "round" : shape,
      });
      const meaning = readFlowchart(result).meaning;
      expect(meaning?.nodes.find((node) => node.id === "C")?.shape).toBe(
        shape === "square" ? "round" : shape,
      );
    }
  });

  it("refuses the ellipse, an unknown shape, @{} nodes and unknown nodes", () => {
    expect(
      reasonOf(
        refusal(R1, {
          kind: "setNodeShape",
          nodeId: "A",
          shape: "ellipse" as never,
        }),
      ),
    ).toBe("invalidShape");
    expect(
      reasonOf(
        refusal(R1, {
          kind: "setNodeShape",
          nodeId: "A",
          shape: "blob" as never,
        }),
      ),
    ).toBe("invalidShape");
    expect(
      reasonOf(
        refusal(R4, { kind: "setNodeShape", nodeId: "A", shape: "round" }),
      ),
    ).toBe("atBlockNode");
    expect(
      reasonOf(
        refusal(R1, { kind: "setNodeShape", nodeId: "Z", shape: "round" }),
      ),
    ).toBe("targetNotFound");
  });
});

describe("addNode", () => {
  it("appends a line with the indentation of the first statement", () => {
    expect(run(R1, { kind: "addNode", label: "New node" })).toBe(
      `${R1}    N1["New node"]\n`,
    );
    expect(
      run("flowchart TD\n\tA --> B\n", { kind: "addNode", label: "x" }),
    ).toBe('flowchart TD\n\tA --> B\n\tN1["x"]\n');
  });

  it("uses the default indentation when the diagram has no statement", () => {
    expect(run("flowchart TD\n", { kind: "addNode", label: "x" })).toBe(
      'flowchart TD\n    N1["x"]\n',
    );
  });

  it("keeps a file that ends without a line break ending without one", () => {
    expect(
      run("flowchart TD\n    A --> B", { kind: "addNode", label: "x" }),
    ).toBe('flowchart TD\n    A --> B\n    N1["x"]');
  });

  it("starts the new line the way the file does: CRLF", () => {
    expect(
      run("flowchart TD\r\n    A --> B\r\n", { kind: "addNode", label: "x" }),
    ).toBe('flowchart TD\r\n    A --> B\r\n    N1["x"]\r\n');
    expect(
      run("flowchart TD\r\n    A --> B", { kind: "addNode", label: "x" }),
    ).toBe('flowchart TD\r\n    A --> B\r\n    N1["x"]');
  });

  it("appends after style, linkStyle and click lines, outside every subgraph", () => {
    expect(run(R2, { kind: "addNode", label: "Z" })).toBe(`${R2}    N1["Z"]\n`);
  });

  it("takes the shape and the id it is given", () => {
    expect(
      run(R1, {
        kind: "addNode",
        label: "Q",
        shape: "diamond",
        id: "Question",
      }),
    ).toBe(`${R1}    Question{"Q"}\n`);
  });

  it("makes up the first id that nothing uses, edge ids and subgraph ids included", () => {
    const source =
      "flowchart TD\n    subgraph N1\n        N2 --> N3\n    end\n    N3 e1@--> N4\n";
    const result = run(source, { kind: "addNode", label: "x" });
    expect(result.endsWith('    N5["x"]\n')).toBe(true);
    const withAuto = "flowchart TD\n    N1 --> N2\n    N2 --> N3\n";
    expect(
      run(withAuto, { kind: "addNode", label: "x" }).endsWith('N4["x"]\n'),
    ).toBe(true);
  });

  const REFUSED_IDS: readonly (readonly [string, string])[] = [
    ["A", "duplicateId"],
    ["L_A_B_0", "duplicateId"],
    ["end", "reservedId"],
    ["subgraph", "reservedId"],
    ["x", "ambiguousId"],
    ["o", "ambiguousId"],
    ["1abc", "invalidId"],
    ["a-b", "invalidId"],
    ["日本", "invalidId"],
    ["", "invalidId"],
    ["a b", "invalidId"],
  ];
  it.each(REFUSED_IDS)("refuses the id %j (%s)", (id, reason) => {
    expect(reasonOf(refusal(R1, { kind: "addNode", label: "x", id }))).toBe(
      reason,
    );
  });

  it("refuses the id of a subgraph and the id of an edge", () => {
    expect(
      reasonOf(refusal(R2, { kind: "addNode", label: "x", id: "Back" })),
    ).toBe("duplicateId");
    expect(
      reasonOf(refusal(R4, { kind: "addNode", label: "x", id: "e1" })),
    ).toBe("duplicateId");
  });

  it("refuses a bad label and an unknown shape", () => {
    expect(reasonOf(refusal(R1, { kind: "addNode", label: 'a"b' }))).toBe(
      "doubleQuote",
    );
    expect(
      reasonOf(
        refusal(R1, { kind: "addNode", label: "x", shape: "ellipse" as never }),
      ),
    ).toBe("invalidShape");
  });
});

describe("addEdge", () => {
  it("appends an edge between two nodes with the default link", () => {
    expect(run(R1, { kind: "addEdge", from: "C", to: "A" })).toBe(
      `${R1}    C --> A\n`,
    );
  });

  it("writes the kind and the label", () => {
    expect(
      run(R1, {
        kind: "addEdge",
        from: "A",
        to: "C",
        link: { type: "arrow_point", stroke: "dotted" },
        label: "note (x) | y",
      }),
    ).toBe(`${R1}    A -.->|"note (x) | y"| C\n`);
  });

  it("appends after the last edge without moving any linkStyle number", () => {
    const result = run(R2, { kind: "addEdge", from: "UI", to: "DB" });
    expect(result).toBe(`${R2}    UI --> DB\n`);
    const edges = readFlowchart(result).meaning?.edges ?? [];
    expect(edges[2]?.style).not.toBeNull();
    expect(edges[4]?.style).toBeNull();
  });

  it("names a parallel edge the way Mermaid does", () => {
    const result = run(R1, { kind: "addEdge", from: "A", to: "B" });
    const ids = readFlowchart(result).meaning?.edges.map((e) => e.id);
    expect(ids?.slice(-2)).toEqual(["L_D_A_0", "L_A_B_2"]);
  });

  it("gives the edge the default interpolation set by linkStyle default", () => {
    const source =
      "flowchart TD\n    A --> B\n    linkStyle default interpolate basis\n";
    const result = run(source, { kind: "addEdge", from: "B", to: "A" });
    expect(readFlowchart(result).meaning?.edges[1]?.interpolate).toBe("basis");
  });

  it("allows a self loop", () => {
    expect(run(R1, { kind: "addEdge", from: "A", to: "A" })).toBe(
      `${R1}    A --> A\n`,
    );
  });

  it("refuses unknown nodes, subgraph ids and edge ids as endpoints", () => {
    expect(reasonOf(refusal(R1, { kind: "addEdge", from: "A", to: "Z" }))).toBe(
      "targetNotFound",
    );
    expect(
      reasonOf(refusal(R2, { kind: "addEdge", from: "Cache", to: "Front" })),
    ).toBe("targetNotFound");
    expect(
      reasonOf(refusal(R4, { kind: "addEdge", from: "A", to: "e1" })),
    ).toBe("targetNotFound");
  });

  it("refuses an invisible link with a label, a bad length and a bad label", () => {
    expect(
      reasonOf(
        refusal(R1, {
          kind: "addEdge",
          from: "A",
          to: "C",
          link: { type: "arrow_open", stroke: "invisible" },
          label: "x",
        }),
      ),
    ).toBe("invisibleLinkLabel");
    expect(
      reasonOf(
        refusal(R1, {
          kind: "addEdge",
          from: "A",
          to: "C",
          link: { type: "arrow_point", stroke: "normal", length: 11 },
        }),
      ),
    ).toBe("invalidLinkLength");
    expect(
      reasonOf(
        refusal(R1, {
          kind: "addEdge",
          from: "A",
          to: "C",
          label: "",
        }),
      ),
    ).toBe("emptyLabel");
    expect(
      reasonOf(
        refusal(R1, {
          kind: "addEdge",
          from: "A",
          to: "C",
          link: { type: "arrow_point", stroke: "invisible" },
        }),
      ),
    ).toBe("invalidLink");
  });

  it("refuses an edge once the diagram has 500", () => {
    const lines = Array.from({ length: 500 }, () => "    A --> B").join("\n");
    const source = `flowchart TD\n${lines}\n`;
    expect(
      reasonOf(refusal(source, { kind: "addEdge", from: "A", to: "B" })),
    ).toBe("tooManyEdges");
  });
});

describe("setEdgeKind", () => {
  it("replaces only the link token and keeps the pipe label", () => {
    expect(
      run(R1, {
        kind: "setEdgeKind",
        target: edge(1, "L_B_C_0"),
        link: { type: "arrow_point", stroke: "thick" },
      }),
    ).toBe(R1.replace("B -->|yes| C", "B ==>|yes| C"));
  });

  it("changes the arrow end and the length", () => {
    expect(
      run(R1, {
        kind: "setEdgeKind",
        target: edge(0, "L_A_B_0"),
        link: { type: "double_arrow_point", stroke: "normal", length: 2 },
      }),
    ).toBe(R1.replace("[Start] --> B", "[Start] <---> B"));
    expect(
      run(R1, {
        kind: "setEdgeKind",
        target: edge(0, "L_A_B_0"),
        link: { type: "arrow_open", stroke: "normal" },
      }),
    ).toBe(R1.replace("[Start] --> B", "[Start] --- B"));
  });

  it("keeps the whitespace around the link, including none at all", () => {
    expect(
      run("flowchart TD\n    A-->B\n", {
        kind: "setEdgeKind",
        target: edge(0, "L_A_B_0"),
        link: { type: "arrow_point", stroke: "dotted" },
      }),
    ).toBe("flowchart TD\n    A-.->B\n");
    expect(
      run("flowchart TD\n    A --> oB\n", {
        kind: "setEdgeKind",
        target: edge(0, "L_A_oB_0"),
        link: { type: "arrow_open", stroke: "normal" },
      }),
    ).toBe("flowchart TD\n    A --- oB\n");
  });

  it("adds a blank where a link ending in x or o would merge with a node id", () => {
    expect(
      run("flowchart TD\n    A-->B\n", {
        kind: "setEdgeKind",
        target: edge(0, "L_A_B_0"),
        link: { type: "double_arrow_cross", stroke: "normal" },
      }),
    ).toBe("flowchart TD\n    A x--x B\n");
    expect(
      run("flowchart TD\n    A-->B\n", {
        kind: "setEdgeKind",
        target: edge(0, "L_A_B_0"),
        link: { type: "arrow_circle", stroke: "thick" },
      }),
    ).toBe("flowchart TD\n    A==o B\n");
    // Blanks that are already there are never touched.
    expect(
      run("flowchart TD\n    A  -->  B\n", {
        kind: "setEdgeKind",
        target: edge(0, "L_A_B_0"),
        link: { type: "double_arrow_cross", stroke: "normal" },
      }),
    ).toBe("flowchart TD\n    A  x--x  B\n");
  });

  it("keeps the id of an edge and its attribute line", () => {
    expect(
      run(R8, {
        kind: "setEdgeKind",
        target: edge(3, "e1"),
        link: { type: "arrow_point", stroke: "dotted" },
      }),
    ).toBe(R8.replace("D e1@==> A", "D e1@-.-> A"));
  });

  it("rewrites an inline label as the pipe form so both halves agree", () => {
    expect(
      run(R8, {
        kind: "setEdgeKind",
        target: edge(2, "L_B_D_0"),
        link: { type: "arrow_point", stroke: "thick" },
      }),
    ).toBe(R8.replace("B -- maybe --> D", 'B ==>|"maybe"| D'));
  });

  it("does nothing when the kind is the one the edge has", () => {
    const plan = planFlowchartOperation(R1, {
      kind: "setEdgeKind",
      target: edge(0, "L_A_B_0"),
      link: { type: "arrow_point", stroke: "normal" },
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
  });

  it("refuses an edge of an & list, a stale target and an invisible link with a label", () => {
    expect(
      reasonOf(
        refusal(R8, {
          kind: "setEdgeKind",
          target: edge(4, "L_E_G_0"),
          link: { type: "arrow_point", stroke: "dotted" },
        }),
      ),
    ).toBe("sharedLink");
    expect(
      reasonOf(
        refusal(R1, {
          kind: "setEdgeKind",
          target: edge(1, "L_A_B_0"),
          link: { type: "arrow_point", stroke: "dotted" },
        }),
      ),
    ).toBe("targetMismatch");
    expect(
      reasonOf(
        refusal(R1, {
          kind: "setEdgeKind",
          target: edge(9, "L_A_B_0"),
          link: { type: "arrow_point", stroke: "dotted" },
        }),
      ),
    ).toBe("targetNotFound");
    expect(
      reasonOf(
        refusal(R1, {
          kind: "setEdgeKind",
          target: edge(1, "L_B_C_0"),
          link: { type: "arrow_open", stroke: "invisible" },
        }),
      ),
    ).toBe("invisibleLinkLabel");
  });

  it("refuses an inline markdown label", () => {
    expect(
      reasonOf(
        refusal('flowchart TD\n    A -- "`md`" --> B\n', {
          kind: "setEdgeKind",
          target: edge(0, "L_A_B_0"),
          link: { type: "arrow_point", stroke: "dotted" },
        }),
      ),
    ).toBe("markdownLabel");
  });
});

describe("setEdgeLabel", () => {
  it("adds a label after the link", () => {
    expect(
      run(R1, {
        kind: "setEdgeLabel",
        target: edge(0, "L_A_B_0"),
        label: "go (now)",
      }),
    ).toBe(R1.replace("[Start] --> B", '[Start] -->|"go (now)"| B'));
  });

  it("changes a pipe label and always quotes it", () => {
    expect(
      run(R1, {
        kind: "setEdgeLabel",
        target: edge(1, "L_B_C_0"),
        label: "y e s",
      }),
    ).toBe(R1.replace("|yes|", '|"y e s"|'));
  });

  it("removes a label, with the blanks between the link and the label", () => {
    expect(
      run(R1, {
        kind: "setEdgeLabel",
        target: edge(1, "L_B_C_0"),
        label: null,
      }),
    ).toBe(R1.replace("-->|yes|", "-->"));
    expect(
      run("flowchart TD\n    A --> |x| B\n", {
        kind: "setEdgeLabel",
        target: edge(0, "L_A_B_0"),
        label: null,
      }),
    ).toBe("flowchart TD\n    A --> B\n");
  });

  it("turns an inline label into the pipe form, or into a bare link when removed", () => {
    expect(
      run(R8, {
        kind: "setEdgeLabel",
        target: edge(2, "L_B_D_0"),
        label: "perhaps",
      }),
    ).toBe(R8.replace("B -- maybe --> D", 'B -->|"perhaps"| D'));
    expect(
      run(R8, {
        kind: "setEdgeLabel",
        target: edge(2, "L_B_D_0"),
        label: null,
      }),
    ).toBe(R8.replace("B -- maybe --> D", "B --> D"));
  });

  it("encodes <, > and line breaks", () => {
    expect(
      run(R1, {
        kind: "setEdgeLabel",
        target: edge(0, "L_A_B_0"),
        label: "a<b\nc",
      }),
    ).toBe(R1.replace("[Start] --> B", '[Start] -->|"a#lt;b<br/>c"| B'));
  });

  it("does nothing for the same label or when there is none to remove", () => {
    for (const [index, id, label] of [
      [1, "L_B_C_0", "yes"],
      [0, "L_A_B_0", null],
    ] as const) {
      const plan = planFlowchartOperation(R1, {
        kind: "setEdgeLabel",
        target: edge(index, id),
        label,
      });
      expect(plan.ok && plan.value.edits).toEqual([]);
    }
  });

  it("refuses empty and unsafe labels, & lists and markdown labels", () => {
    const target = edge(0, "L_A_B_0");
    expect(
      reasonOf(refusal(R1, { kind: "setEdgeLabel", target, label: "" })),
    ).toBe("emptyLabel");
    expect(
      reasonOf(refusal(R1, { kind: "setEdgeLabel", target, label: 'a"b' })),
    ).toBe("doubleQuote");
    expect(
      reasonOf(
        refusal(R8, {
          kind: "setEdgeLabel",
          target: edge(4, "L_E_G_0"),
          label: "x",
        }),
      ),
    ).toBe("sharedLink");
    expect(
      reasonOf(
        refusal('flowchart TD\n    A -->|"`md`"| B\n', {
          kind: "setEdgeLabel",
          target,
          label: "x",
        }),
      ),
    ).toBe("markdownLabel");
  });
});

describe("reconnectEdge", () => {
  it("replaces the id token of the end", () => {
    expect(
      run(R1, {
        kind: "reconnectEdge",
        target: edge(3, "L_D_A_0"),
        end: "end",
        nodeId: "C",
      }),
    ).toBe(R1.replace("D --> A", "D --> C"));
  });

  it("replaces the id token of the start", () => {
    expect(
      run(R1, {
        kind: "reconnectEdge",
        target: edge(3, "L_D_A_0"),
        end: "start",
        nodeId: "C",
      }),
    ).toBe(R1.replace("D --> A", "C --> A"));
  });

  it("keeps an implicit node that only this edge mentioned", () => {
    expect(
      run(R5, {
        kind: "reconnectEdge",
        target: edge(2, "L_C_D_0"),
        end: "end",
        nodeId: "A",
      }),
    ).toBe(R5.replace("C --> D", "C --> A; D"));
    expect(
      run(R5, {
        kind: "reconnectEdge",
        target: edge(0, "L_A_B_0"),
        end: "start",
        nodeId: "C",
      }),
    ).toBe(R5.replace("A --> B", "A; C --> B"));
  });

  it("keeps the label of a node that is defined in the statement", () => {
    expect(
      run(R1, {
        kind: "reconnectEdge",
        target: edge(2, "L_B_D_0"),
        end: "end",
        nodeId: "A",
      }),
    ).toBe(R1.replace("B -->|no| D[Retry]", "B -->|no| A; D[Retry]"));
  });

  it("changes the first start and the last end of a chain", () => {
    expect(
      run(R3, {
        kind: "reconnectEdge",
        target: edge(0, "L_A_B_0"),
        end: "start",
        nodeId: "J",
      }),
    ).toBe(R3.replace("A --> B --> C", "A; J --> B --> C"));
    expect(
      run(R3, {
        kind: "reconnectEdge",
        target: edge(7, "L_I_J_0"),
        end: "end",
        nodeId: "A",
      }),
    ).toBe(R3.replace("I -.-> J", "I -.-> A; J"));
  });

  it("renames the automatic id and renumbers parallel edges", () => {
    const source =
      "flowchart TD\n    A --> B\n    A --> B\n    A --> C\n    linkStyle 1 stroke:#f00\n";
    const result = run(source, {
      kind: "reconnectEdge",
      target: edge(0, "L_A_B_0"),
      end: "end",
      nodeId: "C",
    });
    expect(readFlowchart(result).meaning?.edges.map((e) => e.id)).toEqual([
      "L_A_C_0",
      "L_A_B_0",
      "L_A_C_2",
    ]);
  });

  it("does nothing when the edge already ends there", () => {
    const plan = planFlowchartOperation(R1, {
      kind: "reconnectEdge",
      target: edge(3, "L_D_A_0"),
      end: "end",
      nodeId: "A",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
  });

  it("refuses the middle of a chain, an & list, subgraph ids and unknown nodes", () => {
    const base = {
      kind: "reconnectEdge" as const,
      end: "end" as const,
      nodeId: "J",
    };
    expect(reasonOf(refusal(R3, { ...base, target: edge(0, "L_A_B_0") }))).toBe(
      "sharedEndpoint",
    );
    expect(reasonOf(refusal(R3, { ...base, target: edge(2, "L_D_F_0") }))).toBe(
      "sharedLink",
    );
    expect(
      reasonOf(
        refusal(R2, {
          ...base,
          target: edge(3, "L_Cache_DB_0"),
          nodeId: "Front",
        }),
      ),
    ).toBe("targetNotFound");
    expect(
      reasonOf(
        refusal(R1, { ...base, target: edge(3, "L_D_A_0"), nodeId: "Z" }),
      ),
    ).toBe("targetNotFound");
  });
});

describe("deleteEdge", () => {
  it("removes the whole line of a simple statement", () => {
    expect(run(R1, { kind: "deleteEdge", target: edge(3, "L_D_A_0") })).toBe(
      R1.replace("    D --> A\n", ""),
    );
  });

  it("keeps a node that is defined only on the deleted statement", () => {
    expect(run(R1, { kind: "deleteEdge", target: edge(2, "L_B_D_0") })).toBe(
      R1.replace("B -->|no| D[Retry]", "D[Retry]"),
    );
  });

  it("keeps an implicit node that the edge alone created", () => {
    expect(run(R5, { kind: "deleteEdge", target: edge(2, "L_C_D_0") })).toBe(
      R5.replace("C --> D", "D"),
    );
  });

  it("keeps the nodes at both ends when neither can go", () => {
    const source = "flowchart TD\n    A --> B\n";
    const result = run(source, {
      kind: "deleteEdge",
      target: edge(0, "L_A_B_0"),
    });
    const nodes = readFlowchart(result).meaning?.nodes.map((n) => n.id);
    expect(nodes).toEqual(["A", "B"]);
  });

  it("deletes one link of a chain and renumbers linkStyle", () => {
    const first = run(R3, { kind: "deleteEdge", target: edge(0, "L_A_B_0") });
    // A is mentioned nowhere else, so it stays as a statement of its own.
    expect(first).toBe(
      R3.replace("A --> B --> C", "A; B --> C").replace("5,7", "4,6"),
    );
    const middle = run(R3, { kind: "deleteEdge", target: edge(1, "L_B_C_0") });
    expect(middle).toBe(
      R3.replace("A --> B --> C", "A --> B; C").replace("5,7", "4,6"),
    );
    const last = run(R3, { kind: "deleteEdge", target: edge(7, "L_I_J_0") });
    expect(last).toBe(R3.replace(" -.-> J", "; J").replace("5,7", "5"));
  });

  it("splits a chain at a link in the middle when the neighbours must stay", () => {
    const source =
      "flowchart TD\n    A --> B --> C --> D\n    linkStyle 2 stroke:#f00\n";
    const result = run(source, {
      kind: "deleteEdge",
      target: edge(1, "L_B_C_0"),
    });
    expect(result).toBe(
      "flowchart TD\n    A --> B; C --> D\n    linkStyle 1 stroke:#f00\n",
    );
  });

  it("deletes a labelled link of a chain", () => {
    expect(run(R3, { kind: "deleteEdge", target: edge(6, "L_H_I_0") })).toBe(
      R3.replace("H -->|x| I -.-> J", "H; I -.-> J").replace("5,7", "5,6"),
    );
  });

  it("removes the linkStyle of the deleted edge and renumbers the others", () => {
    const result = run(R2, {
      kind: "deleteEdge",
      target: edge(0, "L_UI_API_0"),
    });
    expect(result).not.toContain("linkStyle 0 stroke:#f00");
    expect(result).toContain("linkStyle 1 stroke:#0a0,stroke-width:3px");
    // UI --> API was the only thing that put UI and API into Front: both stay as mentions.
    expect(result).toContain("UI[UI]; API");
  });

  it("keeps subgraph membership by keeping the mentions inside the block", () => {
    const result = run(R2, {
      kind: "deleteEdge",
      target: edge(1, "L_API_DB_0"),
    });
    const subgraphs = readFlowchart(result).meaning?.subgraphs ?? [];
    const membersOf = (id: string) =>
      subgraphs.find((subgraph) => subgraph.id === id)?.members;
    expect(membersOf("Back")).toEqual(["DB"]);
    expect(membersOf("Front")).toEqual(["UI", "API"]);
  });

  it("deletes an edge with an id together with its attribute line", () => {
    expect(run(R4, { kind: "deleteEdge", target: edge(0, "e1") })).toBe(
      R4.replace("    A e1@--> B\n", "").replace(
        "    e1@{ animate: true }\n",
        "",
      ),
    );
  });

  it("removes a linkStyle that listed only the deleted edge, and edits a list", () => {
    const source =
      "flowchart TD\n    A --> B\n    B --> C\n    C --> D\n    linkStyle 1 stroke:#f00\n    linkStyle 0,1,2 stroke:#0f0\n";
    const result = run(source, {
      kind: "deleteEdge",
      target: edge(1, "L_B_C_0"),
    });
    expect(result).toBe(
      "flowchart TD\n    A --> B\n    C --> D\n    linkStyle 0,1 stroke:#0f0\n",
    );
  });

  it("leaves `linkStyle default` alone", () => {
    const source =
      "flowchart TD\n    A --> B\n    B --> C\n    linkStyle default stroke:#f00\n    linkStyle 1 stroke:#0f0\n";
    const result = run(source, {
      kind: "deleteEdge",
      target: edge(0, "L_A_B_0"),
    });
    expect(result).toContain("linkStyle default stroke:#f00");
    expect(result).toContain("linkStyle 0 stroke:#0f0");
  });

  it("renumbers the automatic ids of parallel edges", () => {
    const source = "flowchart TD\n    A --> B\n    A --> B\n    A --> B\n";
    const result = run(source, {
      kind: "deleteEdge",
      target: edge(0, "L_A_B_0"),
    });
    expect(readFlowchart(result).meaning?.edges.map((e) => e.id)).toEqual([
      "L_A_B_0",
      "L_A_B_2",
    ]);
  });

  it("deletes the last line of a file without a trailing line break, with the break before it", () => {
    expect(
      run("flowchart TD\n    A --> B\n    B --> A", {
        kind: "deleteEdge",
        target: edge(1, "L_B_A_0"),
      }),
    ).toBe("flowchart TD\n    A --> B");
    expect(
      run("flowchart TD\r\n    A --> B\r\n    B --> A", {
        kind: "deleteEdge",
        target: edge(1, "L_B_A_0"),
      }),
    ).toBe("flowchart TD\r\n    A --> B");
  });

  it("keeps CRLF line endings and removes the whole CRLF line", () => {
    const crlf = R1.replace(/\n/g, "\r\n");
    expect(run(crlf, { kind: "deleteEdge", target: edge(3, "L_D_A_0") })).toBe(
      crlf.replace("    D --> A\r\n", ""),
    );
  });

  it("cuts a statement that shares its line", () => {
    const source = "flowchart TD\n    A --> B; C --> D\n";
    const result = run(source, {
      kind: "deleteEdge",
      target: edge(1, "L_C_D_0"),
    });
    expect(readFlowchart(result).meaning?.edges.length).toBe(1);
  });

  it("refuses an edge of an & list, a stale target and a shared attribute line", () => {
    expect(
      reasonOf(refusal(R3, { kind: "deleteEdge", target: edge(2, "L_D_F_0") })),
    ).toBe("sharedLink");
    expect(
      reasonOf(refusal(R1, { kind: "deleteEdge", target: edge(0, "L_A_B_1") })),
    ).toBe("targetMismatch");
    expect(
      reasonOf(
        refusal("flowchart TD\n    A e1@--> B\n    e1@{ animate: true }; C\n", {
          kind: "deleteEdge",
          target: edge(0, "e1"),
        }),
      ),
    ).toBe("attributeLineShared");
    expect(
      reasonOf(
        refusal("flowchart TD\n    A --> B\n    linkStyle 0 stroke:red; C\n", {
          kind: "deleteEdge",
          target: edge(0, "L_A_B_0"),
        }),
      ),
    ).toBe("linkStyleSharesLine");
  });
});

describe("bytes outside the edits", () => {
  it("are never changed, whatever the operation", () => {
    const operations: readonly FlowchartOperation[] = [
      { kind: "setDirection", direction: "RL" },
      { kind: "setNodeLabel", nodeId: "C", label: "Fin" },
      { kind: "setNodeShape", nodeId: "C", shape: "hexagon" },
      { kind: "addNode", label: "x" },
      { kind: "addEdge", from: "C", to: "A", label: "back" },
      {
        kind: "setEdgeKind",
        target: edge(0, "L_A_B_0"),
        link: { type: "arrow_circle", stroke: "dotted" },
      },
      { kind: "setEdgeLabel", target: edge(3, "L_D_A_0"), label: "again" },
      {
        kind: "reconnectEdge",
        target: edge(3, "L_D_A_0"),
        end: "end",
        nodeId: "C",
      },
      { kind: "deleteEdge", target: edge(1, "L_B_C_0") },
    ];
    const source =
      '---\ntitle: T\n---\nflowchart  TD\n\n\t%% note\n  A[Start]   -->   B{Check}   \n  B -->|yes| C[Done]\n  B -->|no| D[Retry]\n  D --> A\n  click A "https://example.com"\n';
    for (const operation of operations) {
      const plan = planFlowchartOperation(source, operation);
      if (!plan.ok) throw new Error(`${operation.kind}: ${plan.error.detail}`);
      const applied = applyTextEdits(source, plan.value.edits);
      if (!applied.ok) throw new Error(applied.error.detail);
      // Everything before the first edit and after the last one is identical.
      const first = Math.min(...plan.value.edits.map((e) => e.start));
      const lastFromEnd = Math.min(
        ...plan.value.edits.map((e) => source.length - e.end),
      );
      expect(applied.value.text.slice(0, first)).toBe(source.slice(0, first));
      expect(
        applied.value.text.slice(applied.value.text.length - lastFromEnd),
      ).toBe(source.slice(source.length - lastFromEnd));
    }
  });
});

describe("verifyFlowchartCandidate", () => {
  const expected = readFlowchart(R1).meaning;
  if (expected === null) throw new Error("fixture must read");

  it("accepts the text the expected meaning was read from", () => {
    expect(verifyFlowchartCandidate(R1, expected).ok).toBe(true);
  });

  it("rejects a candidate whose meaning differs", () => {
    const result = verifyFlowchartCandidate(
      R1.replace("Start", "Begin"),
      expected,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("diagramMeaningMismatch");
  });

  it("rejects a candidate that is not editable", () => {
    const result = verifyFlowchartCandidate(`${R1}    A[oops\n`, expected);
    expect(!result.ok && result.error.kind).toBe("diagramNotEditable");
  });

  it("rejects a phantom node made by a leftover attribute line", () => {
    const source = R4.replace("    A e1@--> B\n", "    A; B\n");
    const reading = readFlowchart(R4).meaning;
    if (reading === null) throw new Error("fixture must read");
    const result = verifyFlowchartCandidate(source, reading);
    expect(result.ok).toBe(false);
  });

  it("rejects a candidate with a directive inside a label", () => {
    const result = verifyFlowchartCandidate(
      R1.replace("Start", "%%{init: {}}%%"),
      expected,
    );
    expect(!result.ok && result.error.kind).toBe("diagramNotEditable");
  });

  it("rejects a candidate of more than 500 edges or 50000 characters", () => {
    const many = `${R1}${"    A --> B\n".repeat(501)}`;
    expect(!verifyFlowchartCandidate(many, expected).ok).toBe(true);
    const long = `${R1}%% ${"x".repeat(50000)}\n`;
    const result = verifyFlowchartCandidate(long, expected);
    expect(!result.ok && result.error.kind).toBe("diagramNotEditable");
  });

  it("rejects a candidate in which the nodes changed their order", () => {
    const reordered =
      "flowchart TD\n    B{Check} --> C[Done]\n    A[Start] --> B\n    B -->|no| D[Retry]\n    D --> A\n";
    expect(!verifyFlowchartCandidate(reordered, expected).ok).toBe(true);
  });
});
