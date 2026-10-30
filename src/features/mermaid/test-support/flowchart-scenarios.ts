// TEST ONLY. The edit scenarios of fixtures/mermaid-gui/flowchart-scenarios.json (see its
// README section): the source, the text a naive hand-made edit produced, and what that naive
// edit did to the diagram in the earlier research.
import type { FlowchartOperation } from "../../../domain/diagram/flowchart/flowchart-operations";

export type NaiveGate = "PASS" | "FAIL-parse" | "FAIL-render" | "FAIL-semantic";

export interface FlowchartScenario {
  // The id of the research scenario (`LR1`, `DE4-chain-naive` ...).
  readonly id: string;
  readonly op: string;
  readonly source: string;
  // The text after the hand-made edit of the research.
  readonly naiveCandidate: string;
  // How Mermaid and the research's comparison judged that text.
  readonly naiveGate: NaiveGate;
  readonly note: string;
}

interface ScenarioFile {
  readonly fixtureVersion: number;
  readonly subject: string;
  readonly scenarios: readonly FlowchartScenario[];
}

const SCENARIO_FIXTURE_VERSION = 1;

const files = import.meta.glob(
  "/fixtures/mermaid-gui/flowchart-scenarios.json",
  {
    import: "default",
    eager: true,
  },
) as Record<string, ScenarioFile>;

export function loadFlowchartScenarios(): readonly FlowchartScenario[] {
  const file = Object.values(files)[0];
  if (file === undefined) throw new Error("flowchart scenarios not found");
  if (file.fixtureVersion !== SCENARIO_FIXTURE_VERSION) {
    throw new Error(`unsupported fixture version ${file.fixtureVersion}`);
  }
  return file.scenarios;
}

// What the product is expected to do with a scenario's intent.
export type ScenarioOutcome =
  | { readonly kind: "plan" }
  // The editor refuses; `reason` is the first word of the error detail.
  | { readonly kind: "refuse"; readonly reason: string };

export interface ScenarioCase {
  readonly id: string;
  readonly operation: FlowchartOperation;
  readonly outcome: ScenarioOutcome;
}
