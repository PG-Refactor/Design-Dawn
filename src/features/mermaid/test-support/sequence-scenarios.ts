// TEST ONLY. The edit scenarios of fixtures/mermaid-gui/sequence-scenarios.json (see its
// README section): the source, the text a naive hand-made edit produced, and what that naive
// edit did to the diagram in the Step 9-7 research.

export type SequenceNaiveGate =
  | "PASS"
  | "FAIL-parse"
  | "FAIL-render"
  | "FAIL-semantic";

export interface SequenceScenario {
  // The id of the research scenario (`SQE-M11` ...).
  readonly id: string;
  readonly op: string;
  readonly source: string;
  // The text after the research's hand-made edit.
  readonly naiveCandidate: string;
  readonly naiveGate: SequenceNaiveGate;
  readonly note: string;
}

interface ScenarioFile {
  readonly fixtureVersion: number;
  readonly subject: string;
  readonly scenarios: readonly SequenceScenario[];
}

const SCENARIO_FIXTURE_VERSION = 1;

const files = import.meta.glob(
  "/fixtures/mermaid-gui/sequence-scenarios.json",
  {
    import: "default",
    eager: true,
  },
) as Record<string, ScenarioFile>;

export function loadSequenceScenarios(): readonly SequenceScenario[] {
  const file = Object.values(files)[0];
  if (file === undefined) throw new Error("sequence scenarios not found");
  if (file.fixtureVersion !== SCENARIO_FIXTURE_VERSION) {
    throw new Error(`unsupported fixture version ${file.fixtureVersion}`);
  }
  return file.scenarios;
}
