// @vitest-environment jsdom
// The flowchart Tier 1 operations (src/domain/diagram/flowchart/flowchart-operations.ts)
// against the real mermaid 12.3.0: every candidate a plan
// produces must be accepted by Mermaid, drawn by the same render check the app uses, and
// Mermaid's own flow db must hold exactly the meaning the operation promised. The db is read
// through an internal API and only here, in tests.
//
// Two sets of inputs:
//   1. the 91 Tier 1 scenarios of the project's earlier research (fixtures/mermaid-gui/
//      flowchart-scenarios.json), each with the product's operation and, where the research
//      showed that a naive edit breaks the diagram, a check that the naive text really differs;
//   2. seeded random operation sequences on every editable input of the corpus.
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
import {
  loadFlowchartScenarios,
  type ScenarioCase,
} from "./test-support/flowchart-scenarios";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

const edge = (index: number, id: string) => ({ index, id });
const R1_EDGES = {
  ab: edge(0, "L_A_B_0"),
  bc: edge(1, "L_B_C_0"),
  bd: edge(2, "L_B_D_0"),
  da: edge(3, "L_D_A_0"),
};
const R2_EDGES = {
  uiApi: edge(0, "L_UI_API_0"),
  apiDb: edge(1, "L_API_DB_0"),
  apiCache: edge(2, "L_API_Cache_0"),
  cacheDb: edge(3, "L_Cache_DB_0"),
};
const R3_EDGES = {
  ab: edge(0, "L_A_B_0"),
  bc: edge(1, "L_B_C_0"),
  df: edge(2, "L_D_F_0"),
  eg: edge(5, "L_E_G_0"),
  hi: edge(6, "L_H_I_0"),
  ij: edge(7, "L_I_J_0"),
};
const R4_EDGES = { e1: edge(0, "e1"), e2: edge(1, "e2") };
const R5_CD = edge(2, "L_C_D_0");
const R8_EDGES = {
  ab: edge(0, "L_A_B_0"),
  bc: edge(1, "L_B_C_0"),
  inlineBd: edge(2, "L_B_D_0"),
  e1: edge(3, "e1"),
  eg: edge(4, "L_E_G_0"),
};

const plan = (id: string, operation: FlowchartOperation): ScenarioCase => ({
  id,
  operation,
  outcome: { kind: "plan" },
});
const refuse = (
  id: string,
  operation: FlowchartOperation,
  reason: string,
): ScenarioCase => ({ id, operation, outcome: { kind: "refuse", reason } });

const label = (nodeId: string, text: string): FlowchartOperation => ({
  kind: "setNodeLabel",
  nodeId,
  label: text,
});
const shape = (
  nodeId: string,
  name: Extract<FlowchartOperation, { kind: "setNodeShape" }>["shape"],
): FlowchartOperation => ({ kind: "setNodeShape", nodeId, shape: name });
const addNode = (text: string, id: string): FlowchartOperation => ({
  kind: "addNode",
  label: text,
  id,
});
const addEdge = (
  from: string,
  to: string,
  extra: { link?: FlowchartLink; label?: string } = {},
): FlowchartOperation => ({ kind: "addEdge", from, to, ...extra });
type FlowchartLink = NonNullable<
  Extract<FlowchartOperation, { kind: "addEdge" }>["link"]
>;
const deleteEdge = (target: ReturnType<typeof edge>): FlowchartOperation => ({
  kind: "deleteEdge",
  target,
});
const reconnect = (
  target: ReturnType<typeof edge>,
  end: "start" | "end",
  nodeId: string,
): FlowchartOperation => ({ kind: "reconnectEdge", target, end, nodeId });
const kind = (
  target: ReturnType<typeof edge>,
  link: FlowchartLink,
): FlowchartOperation => ({ kind: "setEdgeKind", target, link });
const edgeLabel = (
  target: ReturnType<typeof edge>,
  text: string | null,
): FlowchartOperation => ({ kind: "setEdgeLabel", target, label: text });

const DOTTED: FlowchartLink = { type: "arrow_point", stroke: "dotted" };
const THICK: FlowchartLink = { type: "arrow_point", stroke: "thick" };
const OPEN: FlowchartLink = { type: "arrow_open", stroke: "normal" };

// What the product does with the intent of each research scenario. The text of the scenario
// is in the fixture; the research's hand-made edit is its `naiveCandidate`.
const CASES: readonly ScenarioCase[] = [
  plan("LR1", label("A", "Begin")),
  plan("LR2-naive", label("A", "Begin (v2)")),
  plan("LR2-quoted", label("A", "Begin (v2)")),
  plan("LR3-implicit", label("B", "Bee")),
  refuse("LR4-redefined-first", label("A", "New"), "multipleDefinitions"),
  refuse("LR4-redefined-last", label("A", "New"), "multipleDefinitions"),
  refuse("LR5-at-label", label("A", "Warehouse"), "atBlockNode"),
  plan("LR6-with-class", label("A", "Other")),
  plan("LR7-in-subgraph", label("UI", "Interface")),
  plan("LR8-br", label("A", "a\nb")),
  refuse(
    "LR9-init-injection",
    label("A", "%%{init: {'theme':'dark'}}%%"),
    "directive",
  ),
  refuse("LR10-dq", label("A", 'say "hi"'), "doubleQuote"),
  plan("LR11-newline", label("A", "l1\nl2")),
  refuse(
    "LR12-newline-statement",
    label("A", 'x"]\n    click A href "https://evil.example" "t"\n    A["y'),
    "doubleQuote",
  ),
  plan("AN1-append", addNode("New node", "E")),
  refuse("AN3-id-is-subgraph", addNode("Z", "Back"), "duplicateId"),
  refuse("AN4-id-is-edge-id", addNode("X", "e1"), "duplicateId"),
  refuse("AN5-id-is-existing-node", addNode("Dup", "A"), "duplicateId"),
  refuse("AN6-id-end", addNode("X", "end"), "reservedId"),
  refuse("AN7-id-with-hyphen-ja", addNode("X", "my-node"), "invalidId"),
  plan("AN8-after-linkstyle", addNode("Z", "Z")),
  plan("AN9-no-trailing-newline", addNode("Z", "Z")),
  plan("AE1-append", addEdge("C", "A")),
  plan("AE2-middle-no-linkstyle", addEdge("A", "C")),
  plan("AE3-before-indexed-edge", addEdge("UI", "DB")),
  plan("AE3b-append-end", addEdge("UI", "DB")),
  plan("AE3c-after-last-edge-before-style", addEdge("UI", "DB")),
  plan("AE4-in-subgraph", addEdge("UI", "DB")),
  refuse("AE5-new-implicit-node", addEdge("C", "Brand"), "targetNotFound"),
  plan(
    "AE6-label-and-type",
    addEdge("A", "C", { link: DOTTED, label: "note (x)" }),
  ),
  refuse(
    "AE7-endpoint-is-subgraph",
    addEdge("Cache", "Front"),
    "targetNotFound",
  ),
  plan("AE8-after-edge-with-amp", addEdge("A", "J")),
  plan("AE9-pipe-label-quote", addEdge("A", "C", { label: "a | b" })),
  plan("AE10-between-existing-before-class", addEdge("A", "B")),
  plan("DE1-line-both-defined-elsewhere", deleteEdge(R1_EDGES.da)),
  plan("DE2-line-loses-label", deleteEdge(R1_EDGES.bd)),
  plan("DE2b-link-to-semicolon", deleteEdge(R1_EDGES.bd)),
  plan("DE3-last-edge-implicit-node", deleteEdge(R5_CD)),
  plan("DE3b-link-to-semicolon", deleteEdge(R5_CD)),
  plan("DE4-chain-naive", deleteEdge(R3_EDGES.bc)),
  plan("DE4b-chain-renumber", deleteEdge(R3_EDGES.bc)),
  plan("DE4c-chain-first", deleteEdge(R3_EDGES.ab)),
  refuse("DE5-amp-rewrite", deleteEdge(R3_EDGES.df), "sharedLink"),
  refuse("DE5b-amp-rewrite-no-renumber", deleteEdge(R3_EDGES.df), "sharedLink"),
  plan("DE6-edge-id-attr-dangling", deleteEdge(R4_EDGES.e1)),
  plan("DE6b-edge-id-attr-removed", deleteEdge(R4_EDGES.e1)),
  plan("DE7-subgraph-membership", deleteEdge(R2_EDGES.uiApi)),
  plan("DE7b-link-to-semicolon", deleteEdge(R2_EDGES.uiApi)),
  plan("DE8-linkstyle-shift-naive", deleteEdge(R2_EDGES.apiDb)),
  plan("DE8b-linkstyle-renumbered", deleteEdge(R2_EDGES.apiDb)),
  plan("DE9-linkstyle-on-deleted", deleteEdge(R2_EDGES.uiApi)),
  plan("DE10-parallel-edges", deleteEdge(edge(0, "L_A_B_0"))),
  plan("DE11-chain-labeled-first", deleteEdge(R3_EDGES.hi)),
  plan("DE11b-chain-last", deleteEdge(R3_EDGES.ij)),
  plan("CT1", reconnect(R1_EDGES.da, "end", "C")),
  plan("CT2-implicit-vanishes", reconnect(R5_CD, "end", "A")),
  plan("CT2b-keep-node", reconnect(R5_CD, "end", "A")),
  refuse(
    "CT3-chain-middle",
    reconnect(R3_EDGES.ab, "end", "J"),
    "sharedEndpoint",
  ),
  refuse("CT4-amp-token", reconnect(R3_EDGES.eg, "end", "J"), "sharedLink"),
  plan("CT5-chain-last", reconnect(R3_EDGES.ij, "end", "A")),
  plan("CT5b-chain-last-keep", reconnect(R3_EDGES.ij, "end", "A")),
  plan("CT6-edge-id", reconnect(R4_EDGES.e2, "end", "A")),
  plan("CT7-source", reconnect(R1_EDGES.da, "start", "C")),
  refuse(
    "CT8-to-subgraph-id",
    reconnect(R2_EDGES.cacheDb, "end", "Front"),
    "targetNotFound",
  ),
  plan("CS1-diamond-to-round", shape("B", "round")),
  plan("CS2-square-to-circle", shape("A", "circle")),
  plan("CS3-implicit-to-shape", shape("A", "diamond")),
  refuse("CS4-at-shape", shape("A", "hexagon"), "atBlockNode"),
  refuse(
    "CS5-ellipse-render-fails",
    shape("B", "ellipse" as never),
    "invalidShape",
  ),
  refuse("CS6-redefined-first", shape("A", "diamond"), "multipleDefinitions"),
  plan("CS7-label-with-slash-to-lean", shape("A", "lean_right")),
  plan("CS7b-quoted", shape("A", "lean_right")),
  plan("CS8-cylinder-in-subgraph", shape("DB", "diamond")),
  plan("SG7-set-diagram-direction", { kind: "setDirection", direction: "TB" }),
  plan("ET1-arrow-to-dotted", kind(R8_EDGES.ab, DOTTED)),
  plan("ET2-arrow-to-open", kind(R8_EDGES.ab, OPEN)),
  plan("ET3-keep-pipe-label", kind(R8_EDGES.bc, THICK)),
  plan("ET4-add-label", edgeLabel(R8_EDGES.ab, "go (now)")),
  plan("ET5-change-label", edgeLabel(R8_EDGES.bc, "y e s")),
  plan("ET6-remove-label", edgeLabel(R8_EDGES.bc, null)),
  plan("ET7-inline-label-change-text", edgeLabel(R8_EDGES.inlineBd, "perhaps")),
  plan(
    "ET7b-inline-label-change-type-one-side",
    kind(R8_EDGES.inlineBd, THICK),
  ),
  plan("ET7c-inline-label-change-type-both", kind(R8_EDGES.inlineBd, THICK)),
  plan("ET7d-inline-to-pipe", edgeLabel(R8_EDGES.inlineBd, "maybe")),
  plan("ET8-edge-id-kept", kind(R8_EDGES.e1, DOTTED)),
  refuse("ET9-amp-shared-link", kind(R8_EDGES.eg, DOTTED), "sharedLink"),
  plan(
    "ET10-length",
    kind(R8_EDGES.ab, { type: "arrow_point", stroke: "normal", length: 2 }),
  ),
  plan(
    "ET11-bidirectional",
    kind(R8_EDGES.ab, { type: "double_arrow_point", stroke: "normal" }),
  ),
  plan("ET12-no-space-link", kind(edge(0, "L_A_B_0"), DOTTED)),
  plan("ET13-o-prefixed-id-glue", kind(edge(0, "L_A_oB_0"), OPEN)),
  plan("ET14-o-prefixed-id-glue-naive", kind(edge(0, "L_A_oB_0"), OPEN)),
];

const scenarios = loadFlowchartScenarios();

describe("the research scenarios against mermaid 12.3.0", () => {
  it("has a product operation for every scenario of the fixture, and no other", () => {
    expect(scenarios.map((scenario) => scenario.id).sort()).toEqual(
      CASES.map((entry) => entry.id).sort(),
    );
    expect(scenarios).toHaveLength(91);
  });

  const planned = CASES.filter((entry) => entry.outcome.kind === "plan");
  const refused = CASES.filter((entry) => entry.outcome.kind === "refuse");
  it("splits into plans and refusals", () => {
    expect({ planned: planned.length, refused: refused.length }).toEqual({
      planned: 69,
      refused: 22,
    });
  });

  it.each(CASES.map((entry) => [entry.id, entry] as const))(
    "%s",
    async (id, entry) => {
      const scenario = scenarios.find((candidate) => candidate.id === id);
      if (scenario === undefined) throw new Error(`no scenario ${id}`);
      const result = planFlowchartOperation(scenario.source, entry.operation);
      if (entry.outcome.kind === "refuse") {
        expect(result.ok, `${id} should be refused`).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe("invalidDiagramOperation");
        expect(result.error.detail.split(":")[0]).toBe(entry.outcome.reason);
        return;
      }
      if (!result.ok) {
        throw new Error(`${id} refused: ${result.error.detail}`);
      }
      const applied = applyTextEdits(scenario.source, result.value.edits);
      if (!applied.ok) throw new Error(applied.error.detail);
      const candidate = applied.value.text;
      expect(
        verifyFlowchartCandidate(candidate, result.value.expected),
      ).toEqual({
        ok: true,
        value: undefined,
      });
      const agreement = await mermaidAgrees(candidate, result.value.expected);
      expect(agreement.detail).toBe("");
      expect(agreement.agrees).toBe(true);

      if (scenario.naiveGate !== "PASS") {
        // The research showed that the hand-made edit breaks the diagram: here is the proof
        // that the same intent, written naively, really does not give the promised meaning.
        const naive = await mermaidAgrees(
          scenario.naiveCandidate,
          result.value.expected,
        );
        expect(
          naive.agrees,
          `${id}: the naive text was supposed to break (${scenario.naiveGate})`,
        ).toBe(false);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it("shows the danger in the scenarios it ports: the naive texts that broke", () => {
    const broken = scenarios.filter(
      (scenario) => scenario.naiveGate !== "PASS",
    );
    const plannedBroken = broken.filter((scenario) =>
      planned.some((entry) => entry.id === scenario.id),
    );
    expect({
      broken: broken.length,
      plannedBroken: plannedBroken.length,
    }).toEqual({ broken: 31, plannedBroken: 16 });
  });
});

// ---------------------------------------------------------------------------------------
// Random operation sequences

const SEQUENCE_SEED = 20261030;
const SEQUENCE_LENGTH = 3;

const RANDOM_LABELS = [
  "New",
  "Two words",
  "a<b>c",
  "line1\nline2",
  "(x) [y] {z}",
  "a | b ; c",
  "日本語 🐶",
  "a  b",
  "50% #1",
  'quote"',
  " padded",
  "",
  "see #35;",
  "a&amp;b",
  "back\\slash",
  "tick`",
  "%%{init}%%",
  "--> ==> -.-",
];
const SHAPES = [
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
const LINK_TYPES = [
  "arrow_open",
  "arrow_point",
  "arrow_circle",
  "arrow_cross",
  "double_arrow_point",
  "double_arrow_circle",
  "double_arrow_cross",
] as const;
const LINK_STROKES = ["normal", "thick", "dotted", "invisible"] as const;
const DIRECTIONS = ["TB", "BT", "RL", "LR"] as const;
const STALE_TARGET_ONE_IN = 12;

function pick<T>(random: RandomSource, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function randomLink(random: RandomSource): FlowchartLink {
  return {
    type: pick(random, LINK_TYPES),
    stroke: pick(random, LINK_STROKES),
    ...(random() < 0.3 ? { length: 1 + Math.floor(random() * 3) } : {}),
  };
}

function randomOperation(
  random: RandomSource,
  meaning: FlowchartMeaning,
): FlowchartOperation | null {
  const nodes = meaning.nodes.map((node) => node.id);
  const randomEdgeTarget = () => {
    const index = Math.floor(random() * meaning.edges.length);
    const found = meaning.edges[index];
    const stale = random() * STALE_TARGET_ONE_IN < 1;
    return found === undefined
      ? null
      : { index, id: stale ? `${found.id}_stale` : found.id };
  };
  const target = randomEdgeTarget();
  const choice = Math.floor(random() * 10);
  switch (choice) {
    case 0:
      return { kind: "setDirection", direction: pick(random, DIRECTIONS) };
    case 1:
      return nodes.length === 0
        ? null
        : {
            kind: "setNodeLabel",
            nodeId: pick(random, nodes),
            label: pick(random, RANDOM_LABELS),
          };
    case 2:
      return nodes.length === 0
        ? null
        : {
            kind: "setNodeShape",
            nodeId: pick(random, nodes),
            shape: pick(random, SHAPES),
          };
    case 3:
      return { kind: "addNode", label: pick(random, RANDOM_LABELS) };
    case 4:
      return nodes.length === 0
        ? null
        : {
            kind: "addEdge",
            from: pick(random, nodes),
            to: pick(random, nodes),
            ...(random() < 0.5 ? { link: randomLink(random) } : {}),
            ...(random() < 0.5 ? { label: pick(random, RANDOM_LABELS) } : {}),
          };
    case 5:
      return target === null
        ? null
        : { kind: "setEdgeKind", target, link: randomLink(random) };
    case 6:
      return target === null
        ? null
        : {
            kind: "setEdgeLabel",
            target,
            label: random() < 0.3 ? null : pick(random, RANDOM_LABELS),
          };
    case 7:
    case 8:
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
  readonly undrawableInputs: number;
}

describe("random operation sequences", () => {
  it(
    "every plan is refused or reads back, in mermaid, exactly as promised",
    async () => {
      const inputs = await editableInputs(SEQUENCE_SEED);
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
      let undrawableInputs = 0;
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
          kinds.set(operation.kind, (kinds.get(operation.kind) ?? 0) + 1);
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
            // The input itself cannot be drawn here (the jsdom limits, `@{img}`), so its
            // candidates say nothing about the operations.
            undrawableInputs += 1;
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
        undrawableInputs,
      };
      expect(problems).toEqual([]);
      // A plan that fails its own check is refused as `planUnverified`; with the plans as
      // they are written that never happens on this run, so a new one means a plan is wrong.
      expect(
        [...refusals.keys()].filter((reason) =>
          /planUnverified|notPlainlyDeletable/.test(reason),
        ),
      ).toEqual([]);
      expect([...kinds.keys()].sort()).toEqual([
        "addEdge",
        "addNode",
        "deleteEdge",
        "reconnectEdge",
        "setDirection",
        "setEdgeKind",
        "setEdgeLabel",
        "setNodeLabel",
        "setNodeShape",
      ]);
      expect(counts).toEqual(EXPECTED_SEQUENCE_COUNTS);
    },
    TEST_TIMEOUT_MS * 2,
  );
});

// Fixed on purpose (seeded run): when the operations, the reader or Mermaid change, the
// numbers move. Update them only after looking at why.
const EXPECTED_SEQUENCE_COUNTS: SequenceCounts = {
  inputs: 412,
  operations: 1109,
  planned: 776,
  refused: 333,
  noChange: 107,
  mermaidDisagrees: 0,
  verifyRejects: 0,
  undrawableInputs: 0,
};
