// TEST ONLY. The gantt inputs of the differential test: the research corpus
// (fixtures/mermaid-gui/gantt-corpus.json, see its README section) and the gantt cases of
// fixtures/mermaid-gui/sources.json.
import { loadMermaidGuiFixtures } from "../../../domain/diagram/test-fixtures";

export interface GanttCorpusCase {
  // `GT-<group>-<n>` (syntax corpus), `GTE-...:before` / `:naive` (the text before and after a
  // hand-made edit of the research), `gui:` (sources.json).
  readonly id: string;
  readonly group: string;
  readonly source: string;
  readonly note: string;
}

interface GanttCorpusFile {
  readonly fixtureVersion: number;
  readonly subject: string;
  readonly cases: readonly GanttCorpusCase[];
}

const CORPUS_FIXTURE_VERSION = 1;

const corpusFiles = import.meta.glob(
  "/fixtures/mermaid-gui/gantt-corpus.json",
  {
    import: "default",
    eager: true,
  },
) as Record<string, GanttCorpusFile>;

export function loadGanttCorpus(): GanttCorpusFile {
  const file = Object.values(corpusFiles)[0];
  if (file === undefined) throw new Error("gantt corpus fixture not found");
  if (file.fixtureVersion !== CORPUS_FIXTURE_VERSION) {
    throw new Error(`unsupported fixture version ${file.fixtureVersion}`);
  }
  return file;
}

export function loadGuiGanttCases(): readonly GanttCorpusCase[] {
  return loadMermaidGuiFixtures()
    .filter((entry) => entry.diagram === "gantt")
    .map((entry) => ({
      id: `gui:${entry.id}`,
      group: entry.group,
      source: entry.source,
      note: entry.note,
    }));
}
