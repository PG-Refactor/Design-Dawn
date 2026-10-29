// TEST ONLY. The flowchart inputs of the differential test: the research corpus
// (fixtures/mermaid-gui/flowchart-corpus.json, see its README section), the flowchart
// cases of fixtures/mermaid-gui/sources.json and the app's own fixtures/mermaid/flowchart.mmd.
import { loadMermaidGuiFixtures } from "../../../domain/diagram/test-fixtures";

export interface FlowchartCorpusCase {
  // Keeps the origin prefix: `c1:` `c2:` (syntax corpus), `R:` (reference diagrams),
  // `cand:` (the text after a hand-made edit scenario), `gui:` (sources.json), `app:`.
  readonly id: string;
  readonly group: string;
  readonly source: string;
  readonly note: string;
}

interface FlowchartCorpusFile {
  readonly fixtureVersion: number;
  readonly subject: string;
  readonly skippedScenarios: number;
  readonly cases: readonly FlowchartCorpusCase[];
}

const CORPUS_FIXTURE_VERSION = 1;

const corpusFiles = import.meta.glob(
  "/fixtures/mermaid-gui/flowchart-corpus.json",
  {
    import: "default",
    eager: true,
  },
) as Record<string, FlowchartCorpusFile>;

const appFixtureFiles = import.meta.glob("/fixtures/mermaid/flowchart.mmd", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function loadFlowchartCorpus(): FlowchartCorpusFile {
  const file = Object.values(corpusFiles)[0];
  if (file === undefined) throw new Error("flowchart corpus fixture not found");
  if (file.fixtureVersion !== CORPUS_FIXTURE_VERSION) {
    throw new Error(`unsupported fixture version ${file.fixtureVersion}`);
  }
  return file;
}

export function loadGuiFlowchartCases(): readonly FlowchartCorpusCase[] {
  return loadMermaidGuiFixtures()
    .filter((entry) => entry.diagram === "flowchart")
    .map((entry) => ({
      id: `gui:${entry.id}`,
      group: entry.group,
      source: entry.source,
      note: entry.note,
    }));
}

export function loadAppFlowchartCases(): readonly FlowchartCorpusCase[] {
  return Object.entries(appFixtureFiles).map(([path, source]) => ({
    id: `app:${path}`,
    group: "app",
    source,
    note: "the app's own flowchart fixture",
  }));
}
