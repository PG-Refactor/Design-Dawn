// TEST ONLY. Shared by the real-mermaid operation tests (flowchart-operations.real.dom.test.ts
// and flowchart-tier2.real.dom.test.ts): does Mermaid read, draw and mean exactly what an
// operation promised, and the editable inputs the seeded random sequences start from.
import { flowchartEditability } from "../../../domain/diagram/flowchart/flowchart-editability";
import type { FlowchartMeaning } from "../../../domain/diagram/flowchart/flowchart-meaning";
import { readFlowchart } from "../../../domain/diagram/flowchart/flowchart-reader";
import { createDiagramRenderCheck } from "../diagram-render-check";
import { mermaidRenderer } from "../render-mermaid";
import {
  type FlowchartCorpusCase,
  loadAppFlowchartCases,
  loadFlowchartCorpus,
  loadGuiFlowchartCases,
} from "./flowchart-corpus";
import { generateProgram, seededRandom } from "./flowchart-generator";
import { comparableOf, firstDifference } from "./flowchart-meaning-comparison";
import { readFlowchartWithMermaid } from "./mermaid-flowchart-db";

export const renderCheck = createDiagramRenderCheck(mermaidRenderer);
export const TEST_TIMEOUT_MS = 300_000;
export const RENDER_FAILURE_PREFIX = "render fails: ";
export const GENERATED_INPUT_COUNT = 60;

export interface Agreement {
  readonly agrees: boolean;
  readonly detail: string;
}

// Does Mermaid read, draw and mean exactly what `expected` says?
export async function mermaidAgrees(
  candidate: string,
  expected: FlowchartMeaning,
): Promise<Agreement> {
  const reading = await readFlowchartWithMermaid(candidate);
  if (!reading.accepted) {
    return { agrees: false, detail: `mermaid rejects: ${reading.message}` };
  }
  const rendered = await renderCheck(candidate);
  if (!rendered.ok) {
    return {
      agrees: false,
      detail: `${RENDER_FAILURE_PREFIX}${rendered.message}`,
    };
  }
  const difference = firstDifference(comparableOf(expected), reading.meaning);
  return difference === null
    ? { agrees: true, detail: "" }
    : { agrees: false, detail: `meaning differs: ${difference}` };
}

// The editable inputs of the corpus, the GUI and app fixtures, and generated programs, plus
// `extra` hand-made ones.
export async function editableInputs(
  seed: number,
  extra: readonly FlowchartCorpusCase[] = [],
): Promise<readonly FlowchartCorpusCase[]> {
  const corpus = loadFlowchartCorpus();
  const random = seededRandom(seed);
  const countEdges = async (program: string): Promise<number> => {
    const reading = await readFlowchartWithMermaid(program);
    return reading.accepted ? reading.meaning.edges.length : 0;
  };
  const generated: FlowchartCorpusCase[] = [];
  for (let index = 0; index < GENERATED_INPUT_COUNT; index += 1) {
    generated.push({
      id: `generated:${index}`,
      group: "random",
      source: await generateProgram(random, countEdges),
      note: `seed ${seed}`,
    });
  }
  const all = [
    ...corpus.cases,
    ...loadGuiFlowchartCases(),
    ...loadAppFlowchartCases(),
    ...generated,
    ...extra,
  ];
  const usable: FlowchartCorpusCase[] = [];
  for (const input of all) {
    if (flowchartEditability(readFlowchart(input.source)).editable) {
      usable.push(input);
    }
  }
  return usable;
}
