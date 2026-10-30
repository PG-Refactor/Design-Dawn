import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import {
  reasonOfRefusal,
  refusalOf,
  runOperation,
} from "./flowchart-operation-test-support";
import {
  type FlowchartOperation,
  planFlowchartOperation,
} from "./flowchart-operations";
import { readFlowchart } from "./flowchart-reader";

// Tier 2 operations: deleteNode, setSubgraphTitle,
// setSubgraphDirection, createSubgraph, dissolveSubgraph, moveNodeToSubgraph and
// removeNodeFromSubgraph. `runOperation` proves for every success that the candidate reads
// back as the promised meaning and that the inverse edits restore the source.

const CHAINS = `flowchart TD
    A --> B --> C
    D & E --> F
    B -->|x| D
    X[Ex]; Y --> Z
    linkStyle 0 stroke:red
    linkStyle 2,3 stroke:blue
    class B,C hot
    class B hot2
    click B "https://u.example"
    style B fill:#fff
    style C fill:#000
`;

const NESTED = `flowchart TD
    A[Start] --> B
    subgraph Outer["Outer box"]
        direction LR
        subgraph Inner
            C[Cee]
            D
        end
        E
        C --> E
    end
    F
    subgraph Late
        F
        G
    end
    B --> C
`;

const ATTRIBUTES = `flowchart TD
    A@{ shape: cyl, label: "Store" }
    B@{ shape: doc, label: "Report" }
    A e1@--> B
    B e2@==> C
    e1@{ animate: true }
    e2@{ curve: linear }
`;

const FRONT_BACK = `flowchart LR
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

const deleteNode = (nodeId: string): FlowchartOperation => ({
  kind: "deleteNode",
  nodeId,
});
const move = (nodeId: string, subgraphId: string): FlowchartOperation => ({
  kind: "moveNodeToSubgraph",
  nodeId,
  subgraphId,
});
const takeOut = (nodeId: string, subgraphId: string): FlowchartOperation => ({
  kind: "removeNodeFromSubgraph",
  nodeId,
  subgraphId,
});
const dissolve = (subgraphId: string): FlowchartOperation => ({
  kind: "dissolveSubgraph",
  subgraphId,
});

describe("deleteNode", () => {
  it("removes the node, its edges, its style / class / click lines and renumbers linkStyle", () => {
    expect(runOperation(FRONT_BACK, deleteNode("Cache"))).toBe(`flowchart LR
    classDef hot fill:#f96,stroke:#333
    subgraph Front [Frontend]
        direction TB
        UI[UI] --> API
    end
    subgraph Back
        API[API] --> DB[(DB)]
    end
    UI:::hot
    style DB fill:#bbf
    linkStyle 0 stroke:#f00
    click UI "https://example.com" "tip"
`);
  });

  it("drops the edges of a node and the `:::`, click and linkStyle that named it", () => {
    const result = runOperation(FRONT_BACK, deleteNode("UI"));
    expect(result).not.toContain("UI");
    expect(result).toContain("linkStyle 1 stroke:#0a0,stroke-width:3px");
    expect(result).not.toContain("linkStyle 0");
    // API keeps its place in Front through a bare mention.
    expect(result).toContain(
      "subgraph Front [Frontend]\n        direction TB\n        API\n    end",
    );
  });

  it("removes the style line of a node and the edge it ended", () => {
    const result = runOperation(FRONT_BACK, deleteNode("DB"));
    expect(result).not.toContain("DB");
    expect(result).toContain("linkStyle 0 stroke:#f00");
    expect(result).toContain("linkStyle 1 stroke:#0a0,stroke-width:3px");
    expect(result).toContain("subgraph Back\n        API[API]\n    end");
  });

  it("splits a chain at a node in the middle and keeps the neighbours", () => {
    const result = runOperation(CHAINS, deleteNode("B"));
    expect(result).toBe(`flowchart TD
    A; C
    D & E --> F
    X[Ex]; Y --> Z
    linkStyle 0,1 stroke:blue
    class C hot
    style C fill:#000
`);
  });

  it("cuts the first and the last node of a chain", () => {
    expect(runOperation(CHAINS, deleteNode("A"))).toContain("\n    B --> C\n");
    expect(runOperation(CHAINS, deleteNode("C"))).toContain("\n    A --> B\n");
  });

  it("removes a term of an & list and keeps the rest of the list", () => {
    const result = runOperation(CHAINS, deleteNode("D"));
    expect(result).toContain("\n    E --> F\n");
    expect(result).toContain("linkStyle 2 stroke:blue");
    expect(result).not.toContain("B -->|x| D");
  });

  it("leaves the rest of an & list as a statement when the other side goes", () => {
    expect(runOperation(CHAINS, deleteNode("F"))).toContain("\n    D & E\n");
  });

  it("removes a statement that shares its line, with its separator", () => {
    expect(runOperation(CHAINS, deleteNode("X"))).toContain("\n    Y --> Z\n");
    expect(runOperation(CHAINS, deleteNode("Y"))).toContain("\n    X[Ex]; Z\n");
    expect(runOperation(CHAINS, deleteNode("Z"))).toContain("\n    X[Ex]; Y\n");
  });

  it("takes the node out of the target list of class and click, keeping the others", () => {
    const result = runOperation(CHAINS, deleteNode("C"));
    expect(result).toContain("\n    class B hot\n");
    expect(result).toContain("\n    class B hot2\n");
    expect(result).not.toContain("style C");
  });

  it("removes the id@{ ... } lines of the edges that go", () => {
    expect(runOperation(ATTRIBUTES, deleteNode("B"))).toBe(
      `flowchart TD
    A@{ shape: cyl, label: "Store" }
    C
`,
    );
    expect(runOperation(ATTRIBUTES, deleteNode("A"))).toBe(
      `flowchart TD
    B@{ shape: doc, label: "Report" }
    B e2@==> C
    e2@{ curve: linear }
`,
    );
  });

  it("removes a node that only a style statement creates", () => {
    expect(
      runOperation(
        "flowchart TD\n    A --> B\n    style Q fill:#fff\n",
        deleteNode("Q"),
      ),
    ).toBe("flowchart TD\n    A --> B\n");
  });

  it("takes self loops and every edge of the node with it", () => {
    expect(
      runOperation(
        "flowchart TD\n    A --> A\n    A --> B\n    B --> A\n",
        deleteNode("A"),
      ),
    ).toBe("flowchart TD\n    B\n");
  });

  it("keeps CRLF line endings", () => {
    expect(
      runOperation(
        "flowchart TD\r\n    A --> B\r\n    B --> C\r\n    class C hot\r\n",
        deleteNode("C"),
      ),
    ).toBe("flowchart TD\r\n    A --> B\r\n");
  });

  it("deletes the last line of a file without a trailing line break", () => {
    expect(
      runOperation("flowchart TD\n    A --> B\n    C", deleteNode("C")),
    ).toBe("flowchart TD\n    A --> B");
  });

  it("keeps the other nodes of a subgraph and the empty block", () => {
    expect(runOperation(NESTED, deleteNode("C"))).toBe(`flowchart TD
    A[Start] --> B
    subgraph Outer["Outer box"]
        direction LR
        subgraph Inner
            D
        end
        E
    end
    F
    subgraph Late
        F
        G
    end
`);
    expect(
      runOperation(
        "flowchart TD\n    subgraph S\n        A\n    end\n    B\n",
        deleteNode("A"),
      ),
    ).toBe("flowchart TD\n    subgraph S\n    end\n    B\n");
  });

  it("changes nothing but the bytes of the node's own statements", () => {
    const source = `%% keep\nflowchart  TD\n\n    A[Start]   -->   B   \n  %% note\n    B --> C\n    linkStyle 1 stroke:red\n`;
    const result = runOperation(source, deleteNode("C"));
    expect(result).toBe(
      `%% keep\nflowchart  TD\n\n    A[Start]   -->   B   \n  %% note\n`,
    );
  });

  it("refuses an unknown node, a subgraph id and a diagram that is not editable", () => {
    expect(reasonOfRefusal(refusalOf(CHAINS, deleteNode("Nope")))).toBe(
      "targetNotFound",
    );
    expect(reasonOfRefusal(refusalOf(NESTED, deleteNode("Outer")))).toBe(
      "targetNotFound",
    );
    expect(
      reasonOfRefusal(
        refusalOf("flowchart TD\n    A[x --> B\n", deleteNode("A")),
      ),
    ).toBe("unsupportedStatements");
  });

  it("refuses when a linkStyle line it would have to remove shares its line", () => {
    expect(
      reasonOfRefusal(
        refusalOf(
          "flowchart TD\n    A --> B; linkStyle 0 stroke:red\n",
          deleteNode("A"),
        ),
      ),
    ).toBe("linkStyleSharesLine");
  });

  it("refuses a statement that would have to be cut out of the header line", () => {
    for (const source of [
      "flowchart TD; X\n    A --> B\n",
      "flowchart TD; style X fill:#fff\n    X --> B\n",
    ]) {
      expect(reasonOfRefusal(refusalOf(source, deleteNode("X")))).toBe(
        "statementSharesLine",
      );
    }
  });

  it("refuses to share the attribute line of an edge", () => {
    expect(
      reasonOfRefusal(
        refusalOf(
          "flowchart TD\n    A e1@--> B\n    e1@{ animate: true }; C\n",
          deleteNode("A"),
        ),
      ),
    ).toBe("attributeLineShared");
  });
});

describe("setSubgraphTitle", () => {
  it("replaces the text of a quoted title", () => {
    expect(
      runOperation(NESTED, {
        kind: "setSubgraphTitle",
        subgraphId: "Outer",
        title: "Big box",
      }),
    ).toBe(NESTED.replace("Outer box", "Big box"));
  });

  it("quotes an unquoted title and replaces the blanks before the bracket's content", () => {
    expect(
      runOperation(FRONT_BACK, {
        kind: "setSubgraphTitle",
        subgraphId: "Front",
        title: "Fe (new)",
      }),
    ).toBe(FRONT_BACK.replace("[Frontend]", '["Fe (new)"]'));
  });

  it("adds a title to a header that has none, and keeps the id", () => {
    const result = runOperation(FRONT_BACK, {
      kind: "setSubgraphTitle",
      subgraphId: "Back",
      title: "Backend",
    });
    expect(result).toBe(
      FRONT_BACK.replace("subgraph Back\n", 'subgraph Back["Backend"]\n'),
    );
    expect(readFlowchart(result).meaning?.subgraphs[1]?.id).toBe("Back");
  });

  it("encodes < > and line breaks like a node label", () => {
    const result = runOperation(NESTED, {
      kind: "setSubgraphTitle",
      subgraphId: "Inner",
      title: "a<b>\nc",
    });
    expect(result).toContain('subgraph Inner["a#lt;b#gt;<br/>c"]');
  });

  it("does nothing when the title is already the text", () => {
    expect(
      runOperation(NESTED, {
        kind: "setSubgraphTitle",
        subgraphId: "Outer",
        title: "Outer box",
      }),
    ).toBe(NESTED);
  });

  it("refuses an unknown subgraph and an unsafe title", () => {
    expect(
      reasonOfRefusal(
        refusalOf(NESTED, {
          kind: "setSubgraphTitle",
          subgraphId: "A",
          title: "x",
        }),
      ),
    ).toBe("targetNotFound");
    for (const [title, reason] of [
      ["", "emptyLabel"],
      ['say "hi"', "doubleQuote"],
      ["a`b", "backtick"],
      ["%%{init}%%", "directive"],
    ] as const) {
      expect(
        reasonOfRefusal(
          refusalOf(NESTED, {
            kind: "setSubgraphTitle",
            subgraphId: "Inner",
            title,
          }),
        ),
      ).toBe(reason);
    }
  });
});

describe("setSubgraphDirection", () => {
  it("replaces the token of an existing direction line", () => {
    expect(
      runOperation(NESTED, {
        kind: "setSubgraphDirection",
        subgraphId: "Outer",
        direction: "BT",
      }),
    ).toBe(NESTED.replace("direction LR", "direction BT"));
  });

  it("inserts a direction line right after the header, indented like the block", () => {
    expect(
      runOperation(NESTED, {
        kind: "setSubgraphDirection",
        subgraphId: "Inner",
        direction: "RL",
      }),
    ).toBe(
      NESTED.replace(
        "        subgraph Inner\n",
        "        subgraph Inner\n            direction RL\n",
      ),
    );
  });

  it("writes TD for top-to-bottom and leaves a TB / TD line that already says so", () => {
    expect(
      runOperation(NESTED, {
        kind: "setSubgraphDirection",
        subgraphId: "Late",
        direction: "TB",
      }),
    ).toContain("subgraph Late\n        direction TD\n");
    const flat =
      "flowchart TD\n  subgraph S\n    direction TB\n    A --> B\n  end\n";
    expect(
      runOperation(flat, {
        kind: "setSubgraphDirection",
        subgraphId: "S",
        direction: "TB",
      }),
    ).toBe(flat);
  });

  it("removes the direction line, or does nothing when there is none", () => {
    expect(
      runOperation(NESTED, {
        kind: "setSubgraphDirection",
        subgraphId: "Outer",
        direction: null,
      }),
    ).toBe(NESTED.replace("        direction LR\n", ""));
    expect(
      runOperation(NESTED, {
        kind: "setSubgraphDirection",
        subgraphId: "Late",
        direction: null,
      }),
    ).toBe(NESTED);
  });

  it("keeps CRLF line endings", () => {
    const crlf = "flowchart TD\r\n    subgraph S\r\n        A\r\n    end\r\n";
    expect(
      runOperation(crlf, {
        kind: "setSubgraphDirection",
        subgraphId: "S",
        direction: "LR",
      }),
    ).toBe(
      "flowchart TD\r\n    subgraph S\r\n        direction LR\r\n        A\r\n    end\r\n",
    );
  });

  it("refuses an unknown subgraph", () => {
    expect(
      reasonOfRefusal(
        refusalOf(NESTED, {
          kind: "setSubgraphDirection",
          subgraphId: "Nope",
          direction: "LR",
        }),
      ),
    ).toBe("targetNotFound");
  });
});

describe("createSubgraph", () => {
  it("appends an empty block at the top level with a made-up id", () => {
    expect(
      runOperation(FRONT_BACK, {
        kind: "createSubgraph",
        title: "Cache layer",
      }),
    ).toBe(`${FRONT_BACK}    subgraph S1["Cache layer"]\n    end\n`);
  });

  it("puts one node into the new block", () => {
    expect(
      runOperation(FRONT_BACK, {
        kind: "createSubgraph",
        title: "Cache",
        id: "Layer",
        memberId: "Cache",
      }),
    ).toBe(
      `${FRONT_BACK}    subgraph Layer["Cache"]\n        Cache\n    end\n`,
    );
  });

  it("makes up the first id nothing uses", () => {
    const source =
      "flowchart TD\n    subgraph S1\n        A\n    end\n    S2 --> A\n";
    expect(
      runOperation(source, { kind: "createSubgraph", title: "t" }),
    ).toContain('subgraph S3["t"]');
  });

  it("keeps the ending of the file: CRLF, and no final line break", () => {
    expect(
      runOperation("flowchart TD\r\n    A\r\n", {
        kind: "createSubgraph",
        title: "t",
        memberId: "A",
      }),
    ).toBe(
      'flowchart TD\r\n    A\r\n    subgraph S1["t"]\r\n        A\r\n    end\r\n',
    );
    expect(
      runOperation("flowchart TD\n    A", {
        kind: "createSubgraph",
        title: "t",
      }),
    ).toBe('flowchart TD\n    A\n    subgraph S1["t"]\n    end');
  });

  it("refuses a node that already belongs to a block, because the first one keeps it", () => {
    expect(
      reasonOfRefusal(
        refusalOf(FRONT_BACK, {
          kind: "createSubgraph",
          title: "t",
          memberId: "UI",
        }),
      ),
    ).toBe("firstDefinitionWins");
  });

  it("refuses an id in use, a reserved id, an unknown member and a bad title", () => {
    const create = (extra: object): FlowchartOperation => ({
      kind: "createSubgraph",
      title: "t",
      ...extra,
    });
    expect(reasonOfRefusal(refusalOf(FRONT_BACK, create({ id: "Back" })))).toBe(
      "duplicateId",
    );
    expect(reasonOfRefusal(refusalOf(FRONT_BACK, create({ id: "UI" })))).toBe(
      "duplicateId",
    );
    expect(reasonOfRefusal(refusalOf(FRONT_BACK, create({ id: "end" })))).toBe(
      "reservedId",
    );
    expect(
      reasonOfRefusal(refusalOf(FRONT_BACK, create({ id: "my-box" }))),
    ).toBe("invalidId");
    expect(
      reasonOfRefusal(refusalOf(FRONT_BACK, create({ memberId: "Nope" }))),
    ).toBe("targetNotFound");
    expect(reasonOfRefusal(refusalOf(FRONT_BACK, create({ title: "" })))).toBe(
      "emptyLabel",
    );
  });
});

describe("dissolveSubgraph", () => {
  it("removes the header, `end` and direction lines, keeps what was inside and moves it out one level", () => {
    expect(runOperation(FRONT_BACK, dissolve("Front"))).toBe(
      FRONT_BACK.replace(
        "    subgraph Front [Frontend]\n        direction TB\n        UI[UI] --> API\n    end\n",
        "    UI[UI] --> API\n",
      ),
    );
  });

  it("moves the lines of a nested block out, however deep, and leaves other lines alone", () => {
    const result = runOperation(NESTED, dissolve("Inner"));
    expect(result).toContain(
      "        direction LR\n        C[Cee]\n        D\n        E\n        C --> E\n",
    );
    const source =
      "flowchart TD\n    subgraph S\n  %% odd\n        A\n\tB\n    end\n";
    expect(runOperation(source, dissolve("S"))).toBe(
      "flowchart TD\n  %% odd\n    A\n\tB\n",
    );
  });

  it("hands the members of a nested block to the block around it", () => {
    const result = runOperation(NESTED, dissolve("Inner"));
    const outer = readFlowchart(result).meaning?.subgraphs.find(
      (subgraph) => subgraph.id === "Outer",
    );
    expect([...(outer?.members ?? [])].sort()).toEqual(["C", "D", "E"]);
  });

  it("lets a later block take a node the dissolved block used to own", () => {
    const result = runOperation(NESTED, dissolve("Late"));
    expect(readFlowchart(result).meaning?.subgraphs.map((s) => s.id)).toEqual([
      "Inner",
      "Outer",
    ]);
  });

  it("dissolves the block around others and keeps the nested ones", () => {
    const result = runOperation(NESTED, dissolve("Outer"));
    expect(readFlowchart(result).meaning?.subgraphs.map((s) => s.id)).toEqual([
      "Inner",
      "Late",
    ]);
    expect(result).not.toContain("direction LR");
  });

  it("refuses a block whose id is named elsewhere", () => {
    expect(
      reasonOfRefusal(
        refusalOf(
          "flowchart TD\n    subgraph S\n        A\n    end\n    class S hot\n",
          dissolve("S"),
        ),
      ),
    ).toBe("subgraphReferenced");
    expect(
      reasonOfRefusal(
        refusalOf(
          'flowchart TD\n    subgraph S\n        A\n    end\n    click S "https://u.example"\n',
          dissolve("S"),
        ),
      ),
    ).toBe("subgraphReferenced");
  });

  it("refuses an unknown subgraph", () => {
    expect(reasonOfRefusal(refusalOf(NESTED, dissolve("A")))).toBe(
      "targetNotFound",
    );
  });
});

describe("moveNodeToSubgraph", () => {
  it("writes a bare mention before `end`, indented like the block", () => {
    expect(runOperation(FRONT_BACK, move("Cache", "Back"))).toBe(
      FRONT_BACK.replace(
        "        API[API] --> DB[(DB)]\n    end\n",
        "        API[API] --> DB[(DB)]\n        Cache\n    end\n",
      ),
    );
  });

  it("moves a node that was first mentioned further down up in the node order", () => {
    const result = runOperation(NESTED, move("G", "Inner"));
    expect(result).toContain("            D\n            G\n        end");
    expect(readFlowchart(result).meaning?.nodes.map((n) => n.id)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "G",
      "E",
      "F",
    ]);
  });

  it("takes a node from a block that closes later", () => {
    const result = runOperation(NESTED, move("F", "Outer"));
    const subgraphs = readFlowchart(result).meaning?.subgraphs;
    expect(subgraphs?.find((s) => s.id === "Outer")?.members).toContain("F");
    expect(subgraphs?.find((s) => s.id === "Late")?.members).toEqual(["G"]);
  });

  it("does nothing when the block already owns the node", () => {
    expect(runOperation(NESTED, move("D", "Inner"))).toBe(NESTED);
  });

  it("refuses when a block that closes earlier keeps the node", () => {
    expect(reasonOfRefusal(refusalOf(NESTED, move("D", "Late")))).toBe(
      "firstDefinitionWins",
    );
    expect(reasonOfRefusal(refusalOf(FRONT_BACK, move("API", "Back")))).toBe(
      "firstDefinitionWins",
    );
  });

  it("refuses an unknown node or subgraph", () => {
    expect(reasonOfRefusal(refusalOf(NESTED, move("Nope", "Late")))).toBe(
      "targetNotFound",
    );
    expect(reasonOfRefusal(refusalOf(NESTED, move("A", "Nope")))).toBe(
      "targetNotFound",
    );
    expect(reasonOfRefusal(refusalOf(NESTED, move("Inner", "Late")))).toBe(
      "targetNotFound",
    );
  });
});

describe("removeNodeFromSubgraph", () => {
  it("deletes the bare mention when the node is mentioned elsewhere", () => {
    expect(runOperation(NESTED, takeOut("F", "Late"))).toBe(
      NESTED.replace("        F\n        G\n", "        G\n"),
    );
  });

  it("writes the only mention again after `end` so the node does not vanish", () => {
    const result = runOperation(NESTED, takeOut("G", "Late"));
    expect(result).toContain("    subgraph Late\n        F\n    end\n    G\n");
  });

  it("moves the mention to the block around a nested block", () => {
    const result = runOperation(NESTED, takeOut("D", "Inner"));
    expect(result).toContain("        end\n        D\n        E\n");
    const outer = readFlowchart(result).meaning?.subgraphs.find(
      (subgraph) => subgraph.id === "Outer",
    );
    expect(outer?.members).toContain("D");
  });

  it("moves a definition along with its statement", () => {
    const source =
      'flowchart TD\n    subgraph S\n        X["Label"]:::c\n    end\n';
    expect(runOperation(source, takeOut("X", "S"))).toBe(
      'flowchart TD\n    subgraph S\n    end\n    X["Label"]:::c\n',
    );
  });

  it("refuses a node written inside an edge or a list of the block", () => {
    expect(reasonOfRefusal(refusalOf(NESTED, takeOut("E", "Outer")))).toBe(
      "mentionedInStatement",
    );
    expect(reasonOfRefusal(refusalOf(FRONT_BACK, takeOut("DB", "Back")))).toBe(
      "mentionedInStatement",
    );
  });

  it("refuses a node that is not a member, or that another block would take", () => {
    expect(reasonOfRefusal(refusalOf(NESTED, takeOut("G", "Outer")))).toBe(
      "notAMember",
    );
    const source =
      "flowchart TD\n    subgraph One\n        X\n    end\n    subgraph Two\n        X\n    end\n";
    expect(reasonOfRefusal(refusalOf(source, takeOut("X", "One")))).toBe(
      "wouldJoinOther",
    );
  });
});

describe("Tier 2 operations and the bytes they do not touch", () => {
  it("change nothing outside the edited range", () => {
    const source =
      '---\ntitle: T\n---\nflowchart  TD\n\n\t%% note\n  A[Start]   -->   B   \n  subgraph S ["T"]\n    C\n  end\n  B --> C\n  click A "https://example.com"\n';
    const operations: readonly FlowchartOperation[] = [
      deleteNode("B"),
      { kind: "setSubgraphTitle", subgraphId: "S", title: "New" },
      { kind: "setSubgraphDirection", subgraphId: "S", direction: "LR" },
      { kind: "createSubgraph", title: "t", memberId: "A" },
      move("A", "S"),
      takeOut("C", "S"),
    ];
    for (const operation of operations) {
      const plan = planFlowchartOperation(source, operation);
      if (!plan.ok) throw new Error(`${operation.kind}: ${plan.error.detail}`);
      const applied = applyTextEdits(source, plan.value.edits);
      if (!applied.ok) throw new Error(applied.error.detail);
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
