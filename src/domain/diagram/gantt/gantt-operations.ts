import { type DomainResult, err, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import {
  GANTT_AFTER_KEYWORD,
  GANTT_FIELD_SEPARATOR,
  GANTT_GENERATED_ID_PREFIX,
  GANTT_SECTION_KEYWORD,
  GANTT_TAGS,
  GANTT_TITLE_KEYWORD,
  GANTT_UNTIL_KEYWORD,
  type GanttDateFormat,
  type GanttTag,
} from "./gantt-config";
import {
  deleteLinesEdits,
  indentOf,
  insertLineAfter,
} from "./gantt-edit-lines";
import { ganttEditability } from "./gantt-editability";
import {
  checkGanttMeaning,
  findMeaningProblem,
  type GanttMeaning,
  type GanttTaskMeaning,
  ganttMeaningOf,
  orderGanttTags,
} from "./gantt-meaning";
import { parseGantt } from "./gantt-parser";
import {
  validateGanttDateText,
  validateGanttDurationText,
  validateGanttSectionName,
  validateGanttTaskId,
  validateGanttTaskName,
  validateGanttTitle,
} from "./gantt-text";
import type {
  GanttEnd,
  GanttLine,
  GanttReference,
  GanttStart,
  GanttTaskEntry,
  ParsedGantt,
} from "./gantt-types";

// Gantt operations: pure functions from the current source to a minimal set of TextEdits plus
// the meaning the result must have. They replace one field of one line, or insert / delete
// whole lines, so every byte outside the edits stays as it was. The caller applies the edits,
// then proves the candidate with `verifyGanttCandidate`.
//
// A task that has no start of its own (`Task :3d`) starts where the task above it ends, so its
// position IS its dependency. Operations never move such a task, never insert a task in front
// of one, and never delete the task above one: they refuse instead of silently shifting dates
// (the editor has no "freeze the start" rewrite in this version).

export interface GanttTaskTarget {
  // Position among the tasks in source order, plus the name the caller believes it has.
  // Both must agree, so a stale index cannot silently change another task.
  readonly index: number;
  readonly name: string;
}

export interface GanttSectionTarget {
  readonly index: number;
  readonly name: string;
}

export type GanttStartInput =
  | { readonly kind: "date"; readonly text: string }
  | { readonly kind: "after"; readonly ids: readonly string[] };

export type GanttEndInput =
  | { readonly kind: "duration"; readonly text: string }
  | { readonly kind: "date"; readonly text: string }
  | { readonly kind: "until"; readonly ids: readonly string[] };

export type GanttOperation =
  | { readonly kind: "setTitle"; readonly title: string }
  | { readonly kind: "clearTitle" }
  | {
      readonly kind: "addSection";
      readonly name: string;
      // The new section goes after the tasks of this section; the end of the chart when
      // omitted. It never goes directly under an existing header: that would hand the
      // header's tasks to the new section.
      readonly afterSectionIndex?: number;
    }
  | {
      readonly kind: "renameSection";
      readonly target: GanttSectionTarget;
      readonly name: string;
    }
  | { readonly kind: "deleteSection"; readonly target: GanttSectionTarget }
  | {
      readonly kind: "addTask";
      // The end of this section's tasks; the end of the chart when omitted.
      readonly sectionIndex?: number;
      readonly name: string;
      // Generated when omitted.
      readonly id?: string;
      readonly tags?: readonly GanttTag[];
      readonly start: GanttStartInput;
      readonly end: GanttEndInput;
    }
  | {
      readonly kind: "renameTask";
      readonly target: GanttTaskTarget;
      readonly name: string;
    }
  | {
      readonly kind: "setTaskId";
      readonly target: GanttTaskTarget;
      readonly id: string;
    }
  | {
      readonly kind: "setStart";
      readonly target: GanttTaskTarget;
      readonly start: GanttStartInput;
    }
  | {
      readonly kind: "setDuration";
      readonly target: GanttTaskTarget;
      readonly duration: string;
    }
  | {
      readonly kind: "setEnd";
      readonly target: GanttTaskTarget;
      readonly end: GanttEndInput;
    }
  | {
      readonly kind: "setStatusTags";
      readonly target: GanttTaskTarget;
      readonly tags: readonly GanttTag[];
    }
  | { readonly kind: "deleteTask"; readonly target: GanttTaskTarget };

export interface GanttOperationPlan {
  readonly edits: readonly TextEdit[];
  readonly expected: GanttMeaning;
}

interface PreparedGantt {
  readonly parsed: ParsedGantt;
  readonly meaning: GanttMeaning;
  readonly format: GanttDateFormat;
}

function refuse<T>(reason: string, detail: string): DomainResult<T> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

function prepare(source: string): DomainResult<PreparedGantt> {
  const parsed = parseGantt(source);
  const editability = ganttEditability(parsed);
  if (!editability.editable) {
    return err(
      "diagramNotEditable",
      `${editability.reason}: ${editability.detail}`,
    );
  }
  const meaning = ganttMeaningOf(parsed);
  if (meaning === null || parsed.dateFormat === null) {
    return err(
      "diagramNotEditable",
      "noMeaning: the chart has no meaning to edit",
    );
  }
  return ok({ parsed, meaning, format: parsed.dateFormat });
}

function resolveTask(
  parsed: ParsedGantt,
  target: GanttTaskTarget,
): DomainResult<GanttTaskEntry> {
  const task = Number.isInteger(target.index)
    ? parsed.tasks[target.index]
    : undefined;
  if (task === undefined) {
    return refuse("targetNotFound", `no task at index ${target.index}`);
  }
  if (task.name !== target.name) {
    return refuse(
      "targetMismatch",
      `task ${target.index} is ${JSON.stringify(task.name)}, not ${JSON.stringify(target.name)}`,
    );
  }
  return ok(task);
}

function resolveSectionTarget(
  parsed: ParsedGantt,
  target: GanttSectionTarget,
): DomainResult<number> {
  const section = Number.isInteger(target.index)
    ? parsed.sections[target.index]
    : undefined;
  if (section === undefined) {
    return refuse("targetNotFound", `no section at index ${target.index}`);
  }
  if (section.name !== target.name) {
    return refuse(
      "targetMismatch",
      `section ${target.index} is ${JSON.stringify(section.name)}, not ${JSON.stringify(target.name)}`,
    );
  }
  return ok(target.index);
}

function replaceTask(
  meaning: GanttMeaning,
  index: number,
  change: Partial<GanttTaskMeaning>,
): GanttMeaning {
  return {
    ...meaning,
    tasks: meaning.tasks.map((task, position) =>
      position === index ? { ...task, ...change } : task,
    ),
  };
}

// The last chance to refuse: the meaning the operation promises must itself be editable.
function finish(
  edits: readonly TextEdit[],
  expected: GanttMeaning,
): DomainResult<GanttOperationPlan> {
  const problem = findMeaningProblem(expected);
  if (problem !== null) return refuse(problem.code, problem.detail);
  return ok({ edits, expected });
}

function existingIds(meaning: GanttMeaning): ReadonlySet<string> {
  return new Set(
    meaning.tasks.flatMap((task) => (task.id === null ? [] : [task.id])),
  );
}

function idListText(
  keyword: string,
  ids: readonly string[],
  known: ReadonlySet<string>,
): DomainResult<string> {
  if (ids.length === 0) {
    return refuse("noReference", `${keyword} needs at least one task`);
  }
  for (const id of ids) {
    if (!known.has(id)) {
      return refuse(
        "unknownReference",
        `no task has the id ${JSON.stringify(id)}`,
      );
    }
  }
  if (new Set(ids).size !== ids.length) {
    return refuse("duplicateReference", `${keyword} names a task twice`);
  }
  return ok(`${keyword} ${ids.join(" ")}`);
}

function startOf(
  input: GanttStartInput,
  prepared: PreparedGantt,
): DomainResult<{ readonly spec: GanttStart; readonly text: string }> {
  if (input.kind === "date") {
    const date = validateGanttDateText(prepared.format, input.text);
    if (!date.ok) return date;
    return ok({ spec: { kind: "date", text: input.text }, text: input.text });
  }
  const text = idListText(
    GANTT_AFTER_KEYWORD,
    input.ids,
    existingIds(prepared.meaning),
  );
  if (!text.ok) return text;
  return ok({ spec: { kind: "after", ids: [...input.ids] }, text: text.value });
}

function endOf(
  input: GanttEndInput,
  prepared: PreparedGantt,
): DomainResult<{ readonly spec: GanttEnd; readonly text: string }> {
  if (input.kind === "duration") {
    const duration = validateGanttDurationText(input.text);
    if (!duration.ok) return duration;
    return ok({
      spec: { kind: "duration", text: input.text },
      text: input.text,
    });
  }
  if (input.kind === "date") {
    const date = validateGanttDateText(prepared.format, input.text);
    if (!date.ok) return date;
    return ok({ spec: { kind: "date", text: input.text }, text: input.text });
  }
  const text = idListText(
    GANTT_UNTIL_KEYWORD,
    input.ids,
    existingIds(prepared.meaning),
  );
  if (!text.ok) return text;
  return ok({ spec: { kind: "until", ids: [...input.ids] }, text: text.value });
}

function checkTags(
  tags: readonly GanttTag[],
): DomainResult<readonly GanttTag[]> {
  const known: readonly string[] = GANTT_TAGS;
  if (tags.some((tag) => !known.includes(tag))) {
    return refuse("unknownTag", `use one of ${GANTT_TAGS.join(", ")}`);
  }
  if (new Set(tags).size !== tags.length) {
    return refuse("duplicateTag", "a tag is named twice");
  }
  return ok(orderGanttTags(tags));
}

function tagPrefix(tags: readonly GanttTag[]): string {
  return tags.map((tag) => `${tag}${GANTT_FIELD_SEPARATOR}`).join("");
}

// ---- lines ----

type ContentKind = GanttLine["kind"];
const NON_CONTENT_KINDS: ReadonlySet<ContentKind> = new Set([
  "blank",
  "comment",
  "directive",
  "frontMatter",
]);

// The last line, in [from, before), that holds a statement: the place after which a new line
// is neither inside nor in front of anything else.
function lastContentLine(
  parsed: ParsedGantt,
  from: number,
  before: number,
): number {
  for (let index = before - 1; index > from; index -= 1) {
    const line = parsed.lines[index] as GanttLine;
    if (!NON_CONTENT_KINDS.has(line.kind)) return index;
  }
  return from;
}

function headerLineIndex(parsed: ParsedGantt): number {
  return parsed.lines.findIndex((line) => line.kind === "header");
}

// The line after which new text for `sectionIndex` goes: the end of that section's region.
// Without a section, the end of the chart.
function regionEnd(
  parsed: ParsedGantt,
  sectionIndex: number | undefined,
): number {
  if (sectionIndex === undefined) {
    return lastContentLine(
      parsed,
      headerLineIndex(parsed),
      parsed.lines.length,
    );
  }
  const section = parsed.sections[sectionIndex] as { lineIndex: number };
  const next = parsed.sections[sectionIndex + 1];
  return lastContentLine(
    parsed,
    section.lineIndex,
    next?.lineIndex ?? parsed.lines.length,
  );
}

function taskIndentNear(parsed: ParsedGantt, lineIndex: number): string {
  const task = [...parsed.tasks]
    .reverse()
    .find((entry) => entry.lineIndex <= lineIndex);
  return indentOf(
    parsed.lines[(task ?? parsed.tasks[0])?.lineIndex ?? lineIndex],
  );
}

// ---- title ----

export function setTitle(
  source: string,
  title: string,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  if (parsed.titles.length > 1) {
    return refuse(
      "multipleTitles",
      "the chart has more than one title statement",
    );
  }
  const checked = validateGanttTitle(title);
  if (!checked.ok) return checked;
  const expected = { ...meaning, title };
  const existing = parsed.titles[0];
  if (existing !== undefined) {
    if (existing.text === title) return ok({ edits: [], expected });
    return ok({ edits: [{ ...existing.textSpan, text: title }], expected });
  }
  const header = headerLineIndex(parsed);
  const next = parsed.lines.find(
    (line, index) => index > header && !NON_CONTENT_KINDS.has(line.kind),
  );
  const statement = `${indentOf(next)}${GANTT_TITLE_KEYWORD} ${title}`;
  return ok({ edits: [insertLineAfter(parsed, header, statement)], expected });
}

export function clearTitle(source: string): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  if (parsed.titles.length > 1) {
    return refuse(
      "multipleTitles",
      "the chart has more than one title statement",
    );
  }
  const existing = parsed.titles[0];
  if (existing === undefined)
    return refuse("noTitle", "the chart has no title statement");
  return ok({
    edits: deleteLinesEdits(parsed, new Set([existing.lineIndex])),
    expected: { ...meaning, title: "" },
  });
}

// ---- sections ----

export function addSection(
  source: string,
  input: { name: string; afterSectionIndex?: number },
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const name = validateGanttSectionName(input.name);
  if (!name.ok) return name;
  if (meaning.sections.includes(input.name)) {
    return refuse(
      "duplicateSectionName",
      "Mermaid draws sections of one name as one",
    );
  }
  const after = input.afterSectionIndex;
  if (
    after !== undefined &&
    (!Number.isInteger(after) || after < 0 || after >= parsed.sections.length)
  ) {
    return refuse("invalidIndex", `section ${after} does not exist`);
  }
  const anchor = regionEnd(parsed, after);
  const indent = indentOf(parsed.lines[anchor]);
  const statement = `${indent}${GANTT_SECTION_KEYWORD} ${input.name}`;
  const sections = [...meaning.sections];
  sections.splice(
    after === undefined ? sections.length : after + 1,
    0,
    input.name,
  );
  return finish([insertLineAfter(parsed, anchor, statement)], {
    ...meaning,
    sections,
  });
}

export function renameSection(
  source: string,
  target: GanttSectionTarget,
  newName: string,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const index = resolveSectionTarget(parsed, target);
  if (!index.ok) return index;
  const name = validateGanttSectionName(newName);
  if (!name.ok) return name;
  if (
    meaning.sections.some(
      (other, position) => position !== index.value && other === newName,
    )
  ) {
    return refuse(
      "duplicateSectionName",
      "Mermaid draws sections of one name as one",
    );
  }
  const oldName = target.name;
  const expected: GanttMeaning = {
    ...meaning,
    sections: meaning.sections.map((section, position) =>
      position === index.value ? newName : section,
    ),
    tasks: meaning.tasks.map((task, position) =>
      (parsed.tasks[position] as GanttTaskEntry).sectionIndex === index.value &&
      task.section === oldName
        ? { ...task, section: newName }
        : task,
    ),
  };
  const section = parsed.sections[index.value] as {
    nameSpan: { start: number; end: number };
  };
  const edits =
    newName === oldName ? [] : [{ ...section.nameSpan, text: newName }];
  return finish(edits, expected);
}

// Deletes tasks (and, for a section, its header). Refuses when anything would change besides
// the removed lines: a reference to a removed task, a click link, or a task that starts where
// a removed task ended.
function removeTasks(
  prepared: PreparedGantt,
  removed: ReadonlySet<number>,
  extraLines: readonly number[],
  expectedSections: readonly string[],
): DomainResult<GanttOperationPlan> {
  const { parsed, meaning } = prepared;
  const removedIds = new Set(
    [...removed].flatMap((index) => {
      const id = (parsed.tasks[index] as GanttTaskEntry).id;
      return id === null ? [] : [id];
    }),
  );
  if (
    parsed.clicks.some((click) =>
      click.references.some((reference) => removedIds.has(reference.id)),
    )
  ) {
    return refuse(
      "clickLink",
      "a click line names the task; this version does not edit click lines",
    );
  }
  const implicitSuccessor = meaning.tasks.findIndex(
    (task, index) =>
      !removed.has(index) &&
      task.start.kind === "implicit" &&
      removed.has(index - 1),
  );
  if (implicitSuccessor !== -1) {
    return refuse(
      "implicitStart",
      `task ${implicitSuccessor} starts where the removed task ends and would silently move`,
    );
  }
  const lines = new Set([
    ...[...removed].map(
      (index) => (parsed.tasks[index] as GanttTaskEntry).lineIndex,
    ),
    ...extraLines,
  ]);
  return finish(deleteLinesEdits(parsed, lines), {
    ...meaning,
    sections: expectedSections,
    tasks: meaning.tasks.filter((_, index) => !removed.has(index)),
  });
}

export function deleteSection(
  source: string,
  target: GanttSectionTarget,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const index = resolveSectionTarget(parsed, target);
  if (!index.ok) return index;
  const removed = new Set(
    parsed.tasks.flatMap((task, position) =>
      task.sectionIndex === index.value ? [position] : [],
    ),
  );
  return removeTasks(
    prepared.value,
    removed,
    [(parsed.sections[index.value] as { lineIndex: number }).lineIndex],
    meaning.sections.filter((_, position) => position !== index.value),
  );
}

// ---- tasks ----

function nextGeneratedId(known: ReadonlySet<string>): string {
  for (let number = 1; ; number += 1) {
    const candidate = `${GANTT_GENERATED_ID_PREFIX}${number}`;
    if (!known.has(candidate)) return candidate;
  }
}

export function addTask(
  source: string,
  input: Extract<GanttOperation, { kind: "addTask" }>,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const name = validateGanttTaskName(input.name);
  if (!name.ok) return name;
  const known = existingIds(meaning);
  const id = input.id ?? nextGeneratedId(known);
  const idCheck = validateGanttTaskId(id);
  if (!idCheck.ok) return idCheck;
  if (known.has(id))
    return refuse("duplicateId", `a task has the id ${JSON.stringify(id)}`);
  const tags = checkTags(input.tags ?? []);
  if (!tags.ok) return tags;
  const start = startOf(input.start, prepared.value);
  if (!start.ok) return start;
  const end = endOf(input.end, prepared.value);
  if (!end.ok) return end;
  const section = input.sectionIndex;
  if (
    section !== undefined &&
    (!Number.isInteger(section) ||
      section < 0 ||
      section >= parsed.sections.length)
  ) {
    return refuse("invalidIndex", `section ${section} does not exist`);
  }
  const anchor = regionEnd(parsed, section);
  const position = parsed.tasks.filter(
    (task) => task.lineIndex <= anchor,
  ).length;
  const successor = meaning.tasks[position];
  if (successor?.start.kind === "implicit") {
    return refuse(
      "implicitStart",
      `task ${position} starts where the task above it ends and would silently move`,
    );
  }
  const sectionName =
    section === undefined
      ? (meaning.sections.at(-1) ?? "")
      : (meaning.sections[section] as string);
  const added: GanttTaskMeaning = {
    section: sectionName,
    name: input.name,
    id,
    tags: tags.value,
    start: start.value.spec,
    end: end.value.spec,
  };
  const tasks = [...meaning.tasks];
  tasks.splice(position, 0, added);
  const statement = `${taskIndentNear(parsed, anchor)}${input.name} :${tagPrefix(tags.value)}${id}${GANTT_FIELD_SEPARATOR}${start.value.text}${GANTT_FIELD_SEPARATOR}${end.value.text}`;
  return finish([insertLineAfter(parsed, anchor, statement)], {
    ...meaning,
    tasks,
  });
}

export function renameTask(
  source: string,
  target: GanttTaskTarget,
  newName: string,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const task = resolveTask(parsed, target);
  if (!task.ok) return task;
  const name = validateGanttTaskName(newName);
  if (!name.ok) return name;
  const expected = replaceTask(meaning, target.index, { name: newName });
  const edits =
    newName === task.value.name
      ? []
      : [{ ...task.value.nameSpan, text: newName }];
  return finish(edits, expected);
}

function mapReferenceIds<T extends GanttStart | GanttEnd>(
  spec: T,
  from: string,
  to: string,
): T {
  if (spec.kind !== "after" && spec.kind !== "until") return spec;
  return { ...spec, ids: spec.ids.map((id) => (id === from ? to : id)) };
}

export function setTaskId(
  source: string,
  target: GanttTaskTarget,
  newId: string,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const found = resolveTask(parsed, target);
  if (!found.ok) return found;
  const task = found.value;
  const idCheck = validateGanttTaskId(newId);
  if (!idCheck.ok) return idCheck;
  if (task.id === newId) return ok({ edits: [], expected: meaning });
  if (existingIds(meaning).has(newId)) {
    return refuse("duplicateId", `a task has the id ${JSON.stringify(newId)}`);
  }
  if (task.id === null) {
    // `A :2024-01-01, 2d` becomes `A :id, 2024-01-01, 2d`. With a start taken from the task
    // above there is no field to put the id in front of.
    if (task.startSpan === null) {
      return refuse(
        "implicitStart",
        "give the task a start before giving it an id",
      );
    }
    return finish(
      [
        {
          start: task.firstFieldStart,
          end: task.firstFieldStart,
          text: `${newId}${GANTT_FIELD_SEPARATOR}`,
        },
      ],
      replaceTask(meaning, target.index, { id: newId }),
    );
  }
  const oldId = task.id;
  const edits: TextEdit[] = [
    { ...(task.idSpan as { start: number; end: number }), text: newId },
  ];
  const rewrite = (references: readonly GanttReference[]) => {
    for (const reference of references) {
      if (reference.id === oldId)
        edits.push({ ...reference.span, text: newId });
    }
  };
  for (const other of parsed.tasks) {
    rewrite(other.startReferences);
    rewrite(other.endReferences);
  }
  for (const click of parsed.clicks) rewrite(click.references);
  const expected: GanttMeaning = {
    ...meaning,
    tasks: meaning.tasks.map((entry, index) => ({
      ...entry,
      id: index === target.index ? newId : entry.id,
      start: mapReferenceIds(entry.start, oldId, newId),
      end: mapReferenceIds(entry.end, oldId, newId),
    })),
    links: meaning.links.map((link) =>
      link.id === oldId ? { ...link, id: newId } : link,
    ),
  };
  return finish(edits, expected);
}

export function setStart(
  source: string,
  target: GanttTaskTarget,
  input: GanttStartInput,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const found = resolveTask(parsed, target);
  if (!found.ok) return found;
  const task = found.value;
  const start = startOf(input, prepared.value);
  if (!start.ok) return start;
  const expected = replaceTask(meaning, target.index, {
    start: start.value.spec,
  });
  if (task.startSpan === null) {
    // `A :3d` becomes `A :2024-01-01, 3d`: the start goes in front of the end field.
    return finish(
      [
        {
          start: task.endSpan.start,
          end: task.endSpan.start,
          text: `${start.value.text}${GANTT_FIELD_SEPARATOR}`,
        },
      ],
      expected,
    );
  }
  const unchanged =
    JSON.stringify((meaning.tasks[target.index] as GanttTaskMeaning).start) ===
    JSON.stringify(start.value.spec);
  return finish(
    unchanged ? [] : [{ ...task.startSpan, text: start.value.text }],
    expected,
  );
}

export function setEnd(
  source: string,
  target: GanttTaskTarget,
  input: GanttEndInput,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const found = resolveTask(parsed, target);
  if (!found.ok) return found;
  const end = endOf(input, prepared.value);
  if (!end.ok) return end;
  const unchanged =
    JSON.stringify((meaning.tasks[target.index] as GanttTaskMeaning).end) ===
    JSON.stringify(end.value.spec);
  return finish(
    unchanged ? [] : [{ ...found.value.endSpan, text: end.value.text }],
    replaceTask(meaning, target.index, { end: end.value.spec }),
  );
}

export function setStatusTags(
  source: string,
  target: GanttTaskTarget,
  input: readonly GanttTag[],
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const found = resolveTask(parsed, target);
  if (!found.ok) return found;
  const tags = checkTags(input);
  if (!tags.ok) return tags;
  const unchanged =
    JSON.stringify((meaning.tasks[target.index] as GanttTaskMeaning).tags) ===
    JSON.stringify(tags.value);
  return finish(
    unchanged ? [] : [{ ...found.value.tagsSpan, text: tagPrefix(tags.value) }],
    replaceTask(meaning, target.index, { tags: tags.value }),
  );
}

export function deleteTask(
  source: string,
  target: GanttTaskTarget,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const found = resolveTask(prepared.value.parsed, target);
  if (!found.ok) return found;
  return removeTasks(
    prepared.value,
    new Set([target.index]),
    [],
    prepared.value.meaning.sections,
  );
}

export function planGanttOperation(
  source: string,
  operation: GanttOperation,
): DomainResult<GanttOperationPlan> {
  switch (operation.kind) {
    case "setTitle":
      return setTitle(source, operation.title);
    case "clearTitle":
      return clearTitle(source);
    case "addSection":
      return addSection(source, operation);
    case "renameSection":
      return renameSection(source, operation.target, operation.name);
    case "deleteSection":
      return deleteSection(source, operation.target);
    case "addTask":
      return addTask(source, operation);
    case "renameTask":
      return renameTask(source, operation.target, operation.name);
    case "setTaskId":
      return setTaskId(source, operation.target, operation.id);
    case "setStart":
      return setStart(source, operation.target, operation.start);
    case "setDuration":
      return setEnd(source, operation.target, {
        kind: "duration",
        text: operation.duration,
      });
    case "setEnd":
      return setEnd(source, operation.target, operation.end);
    case "setStatusTags":
      return setStatusTags(source, operation.target, operation.tags);
    case "deleteTask":
      return deleteTask(source, operation.target);
  }
}

// Proves a candidate: it must read as an editable gantt chart whose meaning is exactly what
// the operation promised.
export function verifyGanttCandidate(
  candidateSource: string,
  expected: GanttMeaning,
): DomainResult<void> {
  return checkGanttMeaning(parseGantt(candidateSource), expected);
}
