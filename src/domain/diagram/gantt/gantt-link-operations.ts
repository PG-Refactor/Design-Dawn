import type { DomainResult } from "../../shared/domain-result";
import { GANTT_CLICK_KEYWORD, GANTT_LINK_KEYWORD } from "./gantt-config";
import {
  deleteLinesEdits,
  indentOf,
  insertLineAfter,
} from "./gantt-edit-lines";
import type { GanttMeaning } from "./gantt-meaning";
import {
  finish,
  type GanttOperationPlan,
  type GanttTaskTarget,
  prepare,
  readBack,
  refuse,
  resolveTask,
} from "./gantt-operation-support";
import { validateGanttLinkUrl } from "./gantt-text";
import type { GanttClick, GanttLine } from "./gantt-types";

// Links on tasks (Tier 2): `click <id> href "<url>"` written
// below the task (Mermaid ignores a click that comes before its task). Only http(s) URLs.
// `click ... call ...` and several ids on one line are read-only text that the reader keeps
// (a list `click a,b href "..."` is edited by id).

function clickOf(
  clicks: readonly GanttClick[],
  id: string,
): GanttClick | undefined {
  return clicks.find((click) =>
    click.references.some((reference) => reference.id === id),
  );
}

export function addLink(
  source: string,
  target: GanttTaskTarget,
  url: string,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const found = resolveTask(parsed, target);
  if (!found.ok) return found;
  const task = found.value;
  if (task.id === null) {
    return refuse("noTaskId", "give the task an id before linking it");
  }
  const checked = validateGanttLinkUrl(url);
  if (!checked.ok) return checked;
  if (clickOf(parsed.clicks, task.id) !== undefined) {
    return refuse("alreadyLinked", "the task has a link; remove it first");
  }
  const line = parsed.lines[task.lineIndex] as GanttLine;
  const statement = `${indentOf(line)}${GANTT_CLICK_KEYWORD} ${task.id} ${GANTT_LINK_KEYWORD} "${url}"`;
  // The new line sits right below the task, so it comes after every link above it.
  const before = parsed.clicks
    .filter((click) => click.lineIndex < task.lineIndex)
    .reduce((count, click) => count + click.references.length, 0);
  const links = [...meaning.links];
  links.splice(before, 0, { id: task.id, url });
  const edits = [insertLineAfter(parsed, task.lineIndex, statement)];
  const expected: GanttMeaning = { ...meaning, links };
  const planned = finish(edits, expected);
  if (!planned.ok) return planned;
  const verdict = readBack(source, edits, expected);
  return verdict.ok ? planned : verdict;
}

export function removeLink(
  source: string,
  target: GanttTaskTarget,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const found = resolveTask(parsed, target);
  if (!found.ok) return found;
  const task = found.value;
  if (task.id === null) {
    return refuse("noTaskId", "the task has no id, so it has no link");
  }
  const click = clickOf(parsed.clicks, task.id);
  if (click === undefined) {
    return refuse("noLink", "the task has no link");
  }
  const position = click.references.findIndex(
    (reference) => reference.id === task.id,
  );
  const edits =
    click.references.length === 1
      ? deleteLinesEdits(parsed, new Set([click.lineIndex]))
      : [
          position < click.references.length - 1
            ? {
                start: (
                  click.references[position] as { span: { start: number } }
                ).span.start,
                end: (
                  click.references[position + 1] as { span: { start: number } }
                ).span.start,
                text: "",
              }
            : {
                start: (
                  click.references[position - 1] as { span: { end: number } }
                ).span.end,
                end: (click.references[position] as { span: { end: number } })
                  .span.end,
                text: "",
              },
        ];
  const skipped = parsed.clicks
    .filter((other) => other.lineIndex < click.lineIndex)
    .reduce((count, other) => count + other.references.length, 0);
  const links = meaning.links.filter(
    (_, index) => index !== skipped + position,
  );
  const expected: GanttMeaning = { ...meaning, links };
  const planned = finish(edits, expected);
  if (!planned.ok) return planned;
  const verdict = readBack(source, edits, expected);
  return verdict.ok ? planned : verdict;
}
