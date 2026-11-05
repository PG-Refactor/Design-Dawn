// TEST ONLY. Checks a plan of a gantt operation against the real Mermaid 12.3.0: it must
// accept the new text, draw it with the app's render check, read it as the meaning the
// operation promised, put every task where the editor's resolver says, and the edits must be
// undoable to the exact old text. For the operations that promise no date moves (moves,
// copies, links, the axis format) it also compares what Mermaid computes for the old and the
// new text: the multiset of (name, start, end) of the old tasks must be there again.
import { resolveGanttSchedule } from "../../../domain/diagram/gantt/gantt-meaning";
import {
  type GanttOperation,
  planGanttOperation,
  verifyGanttCandidate,
} from "../../../domain/diagram/gantt/gantt-operations";
import {
  applyTextEdits,
  type TextEdit,
} from "../../../domain/diagram/text-edit";
import { createDiagramRenderCheck } from "../diagram-render-check";
import { mermaidRenderer } from "../render-mermaid";
import {
  comparableOfDb,
  comparableOfMeaning,
  firstGanttDifference,
} from "./gantt-meaning-comparison";
import {
  type DbGantt,
  isolateMermaidGanttState,
  readGanttWithMermaid,
  rememberGanttIds,
} from "./mermaid-gantt-db";

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

const DATE_KEEPING_KINDS: ReadonlySet<GanttOperation["kind"]> = new Set([
  "moveTask",
  "moveTaskToSection",
  "moveSection",
  "duplicateTask",
  "setAxisFormat",
  "addLink",
  "removeLink",
]);

// The exact inverse of a set of edits applied to `source`.
export function invertEdits(
  source: string,
  edits: readonly TextEdit[],
): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let delta = 0;
  return sorted.map((edit) => {
    const start = edit.start + delta;
    delta += edit.text.length - (edit.end - edit.start);
    return {
      start,
      end: start + edit.text.length,
      text: source.slice(edit.start, edit.end),
    };
  });
}

async function readDb(source: string): Promise<DbGantt | string> {
  rememberGanttIds(source);
  const reading = await readGanttWithMermaid(source);
  if (!reading.accepted) return `mermaid rejects: ${reading.message}`;
  if (reading.db.tasks === null)
    return `tasks do not compile: ${reading.db.tasksError}`;
  return reading.db;
}

function datedTasks(db: DbGantt): string[] {
  return (db.tasks ?? []).map(
    (task) => `${task.name}|${task.start}|${task.end}`,
  );
}

function missingFrom(
  expected: readonly string[],
  actual: readonly string[],
): string | null {
  const remaining = [...actual];
  for (const entry of expected) {
    const at = remaining.indexOf(entry);
    if (at === -1) return entry;
    remaining.splice(at, 1);
  }
  return null;
}

// Null when the plan is right (or when the editor refuses: not a failure).
export async function checkGanttPlanAgainstMermaid(
  label: string,
  source: string,
  operation: GanttOperation,
): Promise<string | null> {
  const result = planGanttOperation(source, operation);
  if (!result.ok) return null;
  const applied = applyTextEdits(source, result.value.edits);
  if (!applied.ok) return `${label}: ${applied.error.detail}`;
  const text = applied.value.text;
  const verified = verifyGanttCandidate(text, result.value.expected);
  if (!verified.ok) return `${label}: unverified ${verified.error.detail}`;
  const before = await readDb(source);
  const after = await readDb(text);
  if (typeof after === "string")
    return `${label}: ${after}\n${JSON.stringify(text)}`;
  const comparable = comparableOfDb(after);
  if (comparable === null) return `${label}: no db tasks`;
  const difference = firstGanttDifference(
    comparableOfMeaning(result.value.expected),
    comparable,
  );
  if (difference !== null)
    return `${label}: meaning differs: ${difference}\n${JSON.stringify(text)}`;
  const schedule = resolveGanttSchedule(result.value.expected);
  for (const [index, dates] of schedule.entries()) {
    const real = after.tasks?.[index];
    if (dates === null || real === undefined) continue;
    if (dates.start !== real.start || dates.end !== real.end) {
      return `${label}: task ${index} dates: editor ${dates.start}..${dates.end}, mermaid ${real.start}..${real.end}\n${JSON.stringify(text)}`;
    }
  }
  if (DATE_KEEPING_KINDS.has(operation.kind) && typeof before !== "string") {
    const lost = missingFrom(datedTasks(before), datedTasks(after));
    if (lost !== null)
      return `${label}: mermaid no longer has a task ${lost}\n${JSON.stringify(text)}`;
  }
  await isolateMermaidGanttState();
  const drawn = await renderCheck(text);
  if (!drawn.ok)
    return `${label}: does not draw (${drawn.message.slice(0, 100)})`;
  const undone = applyTextEdits(text, invertEdits(source, result.value.edits));
  if (!undone.ok || undone.value.text !== source) {
    return `${label}: the edits are not undoable`;
  }
  return null;
}
