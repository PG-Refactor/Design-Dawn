import { expect } from "vitest";
import { applyTextEdits, type TextEdit } from "../text-edit";
import {
  type FlowchartOperation,
  planFlowchartOperation,
  verifyFlowchartCandidate,
} from "./flowchart-operations";

// Helpers of the operation tests: run an operation the way the application does, and prove
// the result.

// Inverse of a set of edits, in the coordinates of the result. Adjacent deletions invert to
// several insertions at one offset, which applyTextEdits refuses as ambiguous, so they are
// merged into one.
export function invertEdits(
  source: string,
  edits: readonly TextEdit[],
): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let delta = 0;
  const inverse: TextEdit[] = [];
  for (const edit of sorted) {
    const start = edit.start + delta;
    inverse.push({
      start,
      end: start + edit.text.length,
      text: source.slice(edit.start, edit.end),
    });
    delta += edit.text.length - (edit.end - edit.start);
  }
  const merged: TextEdit[] = [];
  for (const edit of inverse) {
    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      last.start === last.end &&
      edit.start === edit.end &&
      last.start === edit.start
    ) {
      merged[merged.length - 1] = { ...last, text: last.text + edit.text };
    } else {
      merged.push(edit);
    }
  }
  return merged;
}

// The edits apply, the candidate reads as exactly the promised meaning, and the inverse edits
// restore the source. Returns the new text.
export function runOperation(
  source: string,
  operation: FlowchartOperation,
): string {
  const plan = planFlowchartOperation(source, operation);
  if (!plan.ok) {
    throw new Error(`refused: ${plan.error.kind} ${plan.error.detail}`);
  }
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(`edits: ${applied.error.detail}`);
  expect(
    verifyFlowchartCandidate(applied.value.text, plan.value.expected),
  ).toEqual({ ok: true, value: undefined });
  expect(applied.value.changed).toBe(plan.value.edits.length > 0);
  const restored = applyTextEdits(
    applied.value.text,
    invertEdits(source, plan.value.edits),
  );
  expect(restored.ok && restored.value.text).toBe(source);
  return applied.value.text;
}

export function refusalOf(source: string, operation: FlowchartOperation) {
  const plan = planFlowchartOperation(source, operation);
  if (plan.ok) throw new Error("expected a refusal");
  return plan.error;
}

export const reasonOfRefusal = (error: { readonly detail: string }): string =>
  error.detail.split(":")[0] as string;
