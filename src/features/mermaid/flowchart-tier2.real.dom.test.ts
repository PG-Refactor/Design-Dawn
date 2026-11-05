// @vitest-environment jsdom
// The flowchart Tier 2 operations against the real mermaid
// 12.3.0: every candidate a plan produces must be accepted by Mermaid, drawn by the same
// render check the app uses, and Mermaid's own flow db must hold exactly the meaning the
// operation promised (node order, members of every subgraph, edge order and ids, linkStyle
// numbers). The db is read through an internal API and only here, in tests.
//
//   1. hand-made scenarios, planned or refused for a stated reason;
//   2. seeded random sequences over every editable input of the corpus, with the Tier 2 and
//      the Tier 1 operations mixed.
import { beforeAll, describe, expect, it } from "vitest";
import type { FlowchartMeaning } from "../../domain/diagram/flowchart/flowchart-meaning";
import {
  type FlowchartOperation,
  planFlowchartOperation,
  verifyFlowchartCandidate,
} from "../../domain/diagram/flowchart/flowchart-operations";
import { readFlowchart } from "../../domain/diagram/flowchart/flowchart-reader";
import { applyTextEdits } from "../../domain/diagram/text-edit";
import {
  type RandomSource,
  seededRandom,
} from "./test-support/flowchart-generator";
import {
  editableInputs,
  mermaidAgrees,
  RENDER_FAILURE_PREFIX,
  renderCheck,
  TEST_TIMEOUT_MS,
} from "./test-support/flowchart-operation-harness";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

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
    classDef hot fill:#f96
    classDef hot2 stroke:#333
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
const ORDER = `flowchart TD
    subgraph One
        X
    end
    P --> Q
    subgraph Two
        Q
        R
    end
    S[Late]
    R --> S
    style T fill:#eee
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
const title = (subgraphId: string, text: string): FlowchartOperation => ({
  kind: "setSubgraphTitle",
  subgraphId,
  title: text,
});
const direction = (
  subgraphId: string,
  value: "TB" | "BT" | "RL" | "LR" | null,
): FlowchartOperation => ({
  kind: "setSubgraphDirection",
  subgraphId,
  direction: value,
});
const create = (text: string, memberId?: string): FlowchartOperation => ({
  kind: "createSubgraph",
  title: text,
  ...(memberId === undefined ? {} : { memberId }),
});

interface Scenario {
  readonly id: string;
  readonly source: string;
  readonly operation: FlowchartOperation;
  // The first word of the refusal, or null when the operation is planned.
  readonly refusal: string | null;
}

const scenario = (
  id: string,
  source: string,
  operation: FlowchartOperation,
  refusal: string | null = null,
): Scenario => ({ id, source, operation, refusal });

const SCENARIOS: readonly Scenario[] = [
  ...["A", "B", "C", "D", "E", "F", "X", "Y", "Z"].map((node) =>
    scenario(`chains-delete-${node}`, CHAINS, deleteNode(node)),
  ),
  ...["A", "B", "C"].map((node) =>
    scenario(`attributes-delete-${node}`, ATTRIBUTES, deleteNode(node)),
  ),
  ...["UI", "API", "DB", "Cache"].map((node) =>
    scenario(`front-back-delete-${node}`, FRONT_BACK, deleteNode(node)),
  ),
  ...["A", "B", "C", "D", "E", "F", "G"].map((node) =>
    scenario(`nested-delete-${node}`, NESTED, deleteNode(node)),
  ),
  ...["P", "Q", "R", "S", "T", "X"].map((node) =>
    scenario(`order-delete-${node}`, ORDER, deleteNode(node)),
  ),
  scenario("delete-unknown", CHAINS, deleteNode("Nope"), "targetNotFound"),
  scenario("delete-subgraph-id", NESTED, deleteNode("Outer"), "targetNotFound"),
  scenario("title-quoted", NESTED, title("Outer", "Big box")),
  scenario("title-unquoted", FRONT_BACK, title("Front", "Fe (new)")),
  scenario("title-added", FRONT_BACK, title("Back", "Backend")),
  scenario("title-entities", NESTED, title("Inner", "a<b>\nc")),
  scenario("title-empty", NESTED, title("Inner", ""), "emptyLabel"),
  scenario("direction-replace", NESTED, direction("Outer", "BT")),
  scenario("direction-insert", NESTED, direction("Inner", "RL")),
  scenario("direction-insert-td", NESTED, direction("Late", "TB")),
  scenario("direction-remove", NESTED, direction("Outer", null)),
  scenario("direction-noop", NESTED, direction("Late", null)),
  scenario("create-empty", FRONT_BACK, create("Cache layer")),
  scenario("create-member", FRONT_BACK, create("Cache", "Cache")),
  scenario(
    "create-owned-member",
    FRONT_BACK,
    create("t", "UI"),
    "firstDefinitionWins",
  ),
  scenario("dissolve-leaf", FRONT_BACK, dissolve("Front")),
  scenario("dissolve-nested", NESTED, dissolve("Inner")),
  scenario("dissolve-outer", NESTED, dissolve("Outer")),
  scenario("dissolve-late", NESTED, dissolve("Late")),
  scenario("dissolve-order", ORDER, dissolve("One")),
  scenario("dissolve-order-two", ORDER, dissolve("Two")),
  scenario("move-to-back", FRONT_BACK, move("Cache", "Back")),
  scenario("move-up-the-order", NESTED, move("G", "Inner")),
  scenario("move-from-later-block", NESTED, move("F", "Outer")),
  scenario(
    "move-owned-earlier",
    NESTED,
    move("D", "Late"),
    "firstDefinitionWins",
  ),
  scenario("move-order-p", ORDER, move("P", "One")),
  scenario("move-order-s", ORDER, move("S", "One")),
  scenario("move-order-t", ORDER, move("T", "One")),
  scenario("move-order-x-two", ORDER, move("X", "Two"), "firstDefinitionWins"),
  scenario("take-out-elsewhere", NESTED, takeOut("F", "Late")),
  scenario("take-out-only-mention", NESTED, takeOut("G", "Late")),
  scenario("take-out-nested", NESTED, takeOut("D", "Inner")),
  scenario("take-out-order-x", ORDER, takeOut("X", "One")),
  scenario("take-out-order-r", ORDER, takeOut("R", "Two")),
  scenario(
    "take-out-edge",
    NESTED,
    takeOut("E", "Outer"),
    "mentionedInStatement",
  ),
];

describe("the Tier 2 scenarios against mermaid 12.3.0", () => {
  it.each(SCENARIOS.map((entry) => [entry.id, entry] as const))(
    "%s",
    async (_id, entry) => {
      const result = planFlowchartOperation(entry.source, entry.operation);
      if (entry.refusal !== null) {
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.detail.split(":")[0]).toBe(entry.refusal);
        return;
      }
      if (!result.ok) throw new Error(`refused: ${result.error.detail}`);
      const applied = applyTextEdits(entry.source, result.value.edits);
      if (!applied.ok) throw new Error(applied.error.detail);
      expect(
        verifyFlowchartCandidate(applied.value.text, result.value.expected),
      ).toEqual({ ok: true, value: undefined });
      const agreement = await mermaidAgrees(
        applied.value.text,
        result.value.expected,
      );
      expect(agreement.detail).toBe("");
      expect(agreement.agrees).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it("covers planned and refused outcomes", () => {
    expect({
      planned: SCENARIOS.filter((entry) => entry.refusal === null).length,
      refused: SCENARIOS.filter((entry) => entry.refusal !== null).length,
    }).toEqual({ planned: 57, refused: 7 });
  });
});

// ---------------------------------------------------------------------------------------
// Random operation sequences

const SEQUENCE_SEED = 20261031;
const SEQUENCE_LENGTH = 4;
const TIER_TWO_SHARE = 0.6;
const STALE_TARGET_ONE_IN = 12;

const TITLES = ["Box", "Two words", "a<b>c", "line1\nline2", "日本語", "", "x"];
const LABELS = ["New", "(x) [y]", "a<b>c", "日本語"];
const DIRECTIONS = ["TB", "BT", "RL", "LR"] as const;

function pick<T>(random: RandomSource, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function randomOperation(
  random: RandomSource,
  meaning: FlowchartMeaning,
): FlowchartOperation | null {
  const nodes = meaning.nodes.map((node) => node.id);
  const subgraphs = meaning.subgraphs.map((subgraph) => subgraph.id);
  if (random() < TIER_TWO_SHARE) {
    switch (Math.floor(random() * 7)) {
      case 0:
        return nodes.length === 0 ? null : deleteNode(pick(random, nodes));
      case 1:
        return subgraphs.length === 0
          ? null
          : title(pick(random, subgraphs), pick(random, TITLES));
      case 2:
        return subgraphs.length === 0
          ? null
          : direction(
              pick(random, subgraphs),
              random() < 0.2 ? null : pick(random, DIRECTIONS),
            );
      case 3:
        return create(
          pick(random, TITLES),
          random() < 0.5 || nodes.length === 0
            ? undefined
            : pick(random, nodes),
        );
      case 4:
        return subgraphs.length === 0
          ? null
          : dissolve(pick(random, subgraphs));
      case 5:
        return nodes.length === 0 || subgraphs.length === 0
          ? null
          : move(pick(random, nodes), pick(random, subgraphs));
      default:
        return nodes.length === 0 || subgraphs.length === 0
          ? null
          : takeOut(pick(random, nodes), pick(random, subgraphs));
    }
  }
  const edgeIndex = Math.floor(random() * meaning.edges.length);
  const found = meaning.edges[edgeIndex];
  const stale = random() * STALE_TARGET_ONE_IN < 1;
  const target =
    found === undefined
      ? null
      : { index: edgeIndex, id: stale ? `${found.id}_stale` : found.id };
  switch (Math.floor(random() * 5)) {
    case 0:
      return nodes.length === 0
        ? null
        : {
            kind: "setNodeLabel",
            nodeId: pick(random, nodes),
            label: pick(random, LABELS),
          };
    case 1:
      return { kind: "addNode", label: pick(random, LABELS) };
    case 2:
      return nodes.length === 0
        ? null
        : {
            kind: "addEdge",
            from: pick(random, nodes),
            to: pick(random, nodes),
          };
    case 3:
      return target === null || nodes.length === 0
        ? null
        : {
            kind: "reconnectEdge",
            target,
            end: random() < 0.5 ? "start" : "end",
            nodeId: pick(random, nodes),
          };
    default:
      return target === null ? null : { kind: "deleteEdge", target };
  }
}

interface SequenceCounts {
  readonly inputs: number;
  readonly operations: number;
  readonly planned: number;
  readonly refused: number;
  readonly noChange: number;
  readonly mermaidDisagrees: number;
  readonly verifyRejects: number;
}

const ALL_KINDS = [
  "addEdge",
  "addNode",
  "createSubgraph",
  "deleteEdge",
  "deleteNode",
  "dissolveSubgraph",
  "moveNodeToSubgraph",
  "reconnectEdge",
  "removeNodeFromSubgraph",
  "setNodeLabel",
  "setSubgraphDirection",
  "setSubgraphTitle",
];

describe("random operation sequences with the Tier 2 operations", () => {
  it(
    "every plan is refused or reads back, in mermaid, exactly as promised",
    async () => {
      const inputs = await editableInputs(
        SEQUENCE_SEED,
        [CHAINS, NESTED, ATTRIBUTES, FRONT_BACK, ORDER].map(
          (source, index) => ({
            id: `hand:${index}`,
            group: "hand",
            source,
            note: "hand-made, rich in subgraphs",
          }),
        ),
      );
      const random = seededRandom(SEQUENCE_SEED + 1);
      const refusals = new Map<string, number>();
      const kinds = new Map<string, number>();
      const problems: string[] = [];
      let operations = 0;
      let planned = 0;
      let refused = 0;
      let noChange = 0;
      let mermaidDisagrees = 0;
      let verifyRejects = 0;
      for (const input of inputs) {
        let source = input.source;
        for (let step = 0; step < SEQUENCE_LENGTH; step += 1) {
          const meaning = readFlowchart(source).meaning;
          if (meaning === null) break;
          const operation = randomOperation(random, meaning);
          if (operation === null) continue;
          operations += 1;
          const result = planFlowchartOperation(source, operation);
          if (!result.ok) {
            refused += 1;
            const reason = `${result.error.kind}:${result.error.detail.split(":")[0]}`;
            refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
            continue;
          }
          planned += 1;
          const applied = applyTextEdits(source, result.value.edits);
          if (!applied.ok) {
            problems.push(
              `${input.id} ${operation.kind}: ${applied.error.detail}`,
            );
            continue;
          }
          if (!applied.value.changed) {
            noChange += 1;
            continue;
          }
          kinds.set(operation.kind, (kinds.get(operation.kind) ?? 0) + 1);
          const candidate = applied.value.text;
          if (!verifyFlowchartCandidate(candidate, result.value.expected).ok) {
            verifyRejects += 1;
            problems.push(
              `${input.id} ${operation.kind}: verify rejects its own plan`,
            );
            continue;
          }
          const agreement = await mermaidAgrees(
            candidate,
            result.value.expected,
          );
          if (
            !agreement.agrees &&
            agreement.detail.startsWith(RENDER_FAILURE_PREFIX) &&
            !(await renderCheck(input.source)).ok
          ) {
            // The input itself cannot be drawn here (the jsdom limits), so its candidates
            // say nothing about the operations.
            break;
          }
          if (!agreement.agrees) {
            mermaidDisagrees += 1;
            problems.push(
              `${input.id} ${JSON.stringify(operation)}: ${agreement.detail}\n    ${JSON.stringify(candidate).slice(0, 400)}`,
            );
            continue;
          }
          source = candidate;
        }
      }
      const counts: SequenceCounts = {
        inputs: inputs.length,
        operations,
        planned,
        refused,
        noChange,
        mermaidDisagrees,
        verifyRejects,
      };
      expect(problems).toEqual([]);
      // A plan that fails its own check is refused as `planUnverified`; with the plans as
      // they are written that never happens on this run, so a new one means a plan is wrong.
      expect(
        [...refusals.keys()].filter((reason) => /planUnverified/.test(reason)),
      ).toEqual([]);
      expect([...kinds.keys()].sort()).toEqual([...ALL_KINDS].sort());
      expect(Object.fromEntries([...kinds].sort())).toEqual(
        EXPECTED_KIND_COUNTS,
      );
      expect(counts).toEqual(EXPECTED_SEQUENCE_COUNTS);
    },
    TEST_TIMEOUT_MS * 2,
  );
});

// Fixed on purpose (seeded run): when the operations, the reader or Mermaid change, the
// numbers move. Update them only after looking at why.
const EXPECTED_SEQUENCE_COUNTS: SequenceCounts = {
  inputs: 419,
  operations: 1098,
  planned: 935,
  refused: 163,
  noChange: 48,
  mermaidDisagrees: 0,
  verifyRejects: 0,
};
// Plans that changed the text, by operation.
const EXPECTED_KIND_COUNTS: Record<string, number> = {
  addEdge: 130,
  addNode: 119,
  createSubgraph: 96,
  deleteEdge: 83,
  deleteNode: 157,
  dissolveSubgraph: 37,
  moveNodeToSubgraph: 21,
  reconnectEdge: 40,
  removeNodeFromSubgraph: 10,
  setNodeLabel: 125,
  setSubgraphDirection: 39,
  setSubgraphTitle: 30,
};
