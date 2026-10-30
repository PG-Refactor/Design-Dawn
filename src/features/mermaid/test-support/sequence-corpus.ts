// TEST ONLY. The sequence inputs of the differential test: the research corpus
// (fixtures/mermaid-gui/sequence-corpus.json, see its README section), the sequence cases of
// fixtures/mermaid-gui/sources.json and the app's own fixtures/mermaid/sequence.mmd.
import { loadMermaidGuiFixtures } from "../../../domain/diagram/test-fixtures";

export interface SequenceCorpusCase {
  // Keeps the origin prefix: `SQ-` (syntax corpus), `cand:` (the text of an edit scenario
  // before / after a hand-made edit), `gui:` (sources.json), `app:`.
  readonly id: string;
  readonly group: string;
  readonly source: string;
  readonly note: string;
}

interface SequenceCorpusFile {
  readonly fixtureVersion: number;
  readonly subject: string;
  readonly cases: readonly SequenceCorpusCase[];
}

const CORPUS_FIXTURE_VERSION = 1;

const corpusFiles = import.meta.glob(
  "/fixtures/mermaid-gui/sequence-corpus.json",
  { import: "default", eager: true },
) as Record<string, SequenceCorpusFile>;

const appFixtureFiles = import.meta.glob("/fixtures/mermaid/sequence.mmd", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function loadSequenceCorpus(): SequenceCorpusFile {
  const file = Object.values(corpusFiles)[0];
  if (file === undefined) throw new Error("sequence corpus fixture not found");
  if (file.fixtureVersion !== CORPUS_FIXTURE_VERSION) {
    throw new Error(`unsupported fixture version ${file.fixtureVersion}`);
  }
  return file;
}

export function loadGuiSequenceCases(): readonly SequenceCorpusCase[] {
  return loadMermaidGuiFixtures()
    .filter((entry) => entry.diagram === "sequence")
    .map((entry) => ({
      id: `gui:${entry.id}`,
      group: entry.group,
      source: entry.source,
      note: entry.note,
    }));
}

export function loadAppSequenceCases(): readonly SequenceCorpusCase[] {
  return Object.entries(appFixtureFiles).map(([path, source]) => ({
    id: `app:${path}`,
    group: "app",
    source,
    note: "the app's own sequence fixture",
  }));
}
