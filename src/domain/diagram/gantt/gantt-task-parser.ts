import {
  GANTT_AFTER_PATTERN,
  GANTT_AUTO_ID_PATTERN,
  GANTT_ID_PATTERN,
  GANTT_TAGS,
  GANTT_UNTIL_PATTERN,
  type GanttDateFormat,
  type GanttTag,
} from "./gantt-config";
import { isGanttDuration, parseGanttDate } from "./gantt-date";
import type {
  GanttEnd,
  GanttReference,
  GanttStart,
  GanttTaskEntry,
  GanttUnsupportedReason,
  InvalidSpec,
  TextSpan,
} from "./gantt-types";

// The data of a task line, the text after the first colon:
//   [tags,] [id,] [start,] end        (1 field: end; 2: start, end; 3: id, start, end)
// Mermaid fills a missing start from the previous task and a missing id with `task<N>`;
// 0 data fields or 4 and more fail when the chart is drawn. Tags are lower-case words that
// must come first.

const MAX_DATA_FIELDS = 3;
const REFERENCE_PATTERN = /[A-Za-z0-9_-]+/g;
const TAG_WORDS: ReadonlySet<string> = new Set(GANTT_TAGS);

interface RawField {
  readonly text: string;
  readonly span: TextSpan;
}

function splitFields(data: string, dataStart: number): readonly RawField[] {
  const fields: RawField[] = [];
  let from = 0;
  for (let index = 0; index <= data.length; index += 1) {
    if (index !== data.length && data[index] !== ",") continue;
    const segment = data.slice(from, index);
    const lead = segment.length - segment.trimStart().length;
    const text = segment.trim();
    const start = dataStart + from + lead;
    fields.push({ text, span: { start, end: start + text.length } });
    from = index + 1;
  }
  return fields;
}

function referencesOf(
  text: string,
  keywordLength: number,
  fieldStart: number,
): readonly GanttReference[] {
  const references: GanttReference[] = [];
  const rest = text.slice(keywordLength);
  for (const match of rest.matchAll(REFERENCE_PATTERN)) {
    const start = fieldStart + keywordLength + match.index;
    references.push({
      id: match[0],
      span: { start, end: start + match[0].length },
    });
  }
  return references;
}

interface Classified<Spec> {
  readonly spec: Spec | InvalidSpec;
  readonly references: readonly GanttReference[];
}

const AFTER_KEYWORD_LENGTH = "after".length;
const UNTIL_KEYWORD_LENGTH = "until".length;

function classifyStart(
  field: RawField,
  format: GanttDateFormat | null,
): Classified<GanttStart> {
  const after = GANTT_AFTER_PATTERN.exec(field.text);
  if (after !== null) {
    const references = referencesOf(
      field.text,
      AFTER_KEYWORD_LENGTH,
      field.span.start,
    );
    return {
      spec: { kind: "after", ids: references.map((reference) => reference.id) },
      references,
    };
  }
  if (format !== null && parseGanttDate(format, field.text) !== null) {
    return { spec: { kind: "date", text: field.text }, references: [] };
  }
  return { spec: { kind: "invalid", text: field.text }, references: [] };
}

function classifyEnd(
  field: RawField,
  format: GanttDateFormat | null,
): Classified<GanttEnd> {
  const until = GANTT_UNTIL_PATTERN.exec(field.text);
  if (until !== null) {
    const references = referencesOf(
      field.text,
      UNTIL_KEYWORD_LENGTH,
      field.span.start,
    );
    return {
      spec: { kind: "until", ids: references.map((reference) => reference.id) },
      references,
    };
  }
  if (format !== null && parseGanttDate(format, field.text) !== null) {
    return { spec: { kind: "date", text: field.text }, references: [] };
  }
  if (isGanttDuration(field.text)) {
    return { spec: { kind: "duration", text: field.text }, references: [] };
  }
  return { spec: { kind: "invalid", text: field.text }, references: [] };
}

export type TaskDataResult =
  | {
      readonly ok: true;
      readonly task: Omit<
        GanttTaskEntry,
        "lineIndex" | "sectionIndex" | "name" | "nameSpan"
      >;
    }
  | { readonly ok: false; readonly reason: GanttUnsupportedReason };

export function parseTaskData(
  data: string,
  dataStart: number,
  format: GanttDateFormat | null,
): TaskDataResult {
  const fields = splitFields(data, dataStart);
  if (fields.some((field) => field.text === "")) {
    return { ok: false, reason: "emptyField" };
  }
  let tagCount = 0;
  while (
    tagCount < fields.length &&
    TAG_WORDS.has((fields[tagCount] as RawField).text)
  ) {
    tagCount += 1;
  }
  const tags = fields.slice(0, tagCount).map((field) => field.text as GanttTag);
  if (new Set(tags).size !== tags.length) {
    return { ok: false, reason: "duplicateTag" };
  }
  const rest = fields.slice(tagCount);
  if (rest.length === 0) return { ok: false, reason: "noDataAfterTags" };
  if (rest.length > MAX_DATA_FIELDS)
    return { ok: false, reason: "tooManyFields" };
  const firstField = rest[0] as RawField;
  const tagsSpan: TextSpan = {
    start:
      tagCount === 0
        ? firstField.span.start
        : (fields[0] as RawField).span.start,
    end: firstField.span.start,
  };
  let idField: RawField | null = null;
  let startField: RawField | null = null;
  const endField = rest[rest.length - 1] as RawField;
  if (rest.length === MAX_DATA_FIELDS) {
    idField = rest[0] as RawField;
    startField = rest[1] as RawField;
  } else if (rest.length === 2) {
    startField = rest[0] as RawField;
  }
  if (idField !== null) {
    if (!GANTT_ID_PATTERN.test(idField.text))
      return { ok: false, reason: "invalidId" };
    if (GANTT_AUTO_ID_PATTERN.test(idField.text))
      return { ok: false, reason: "autoIdShape" };
  }
  const start: Classified<GanttStart> =
    startField === null
      ? { spec: { kind: "implicit" }, references: [] }
      : classifyStart(startField, format);
  const end = classifyEnd(endField, format);
  const references = [...start.references, ...end.references];
  if (
    references.some((reference) => GANTT_AUTO_ID_PATTERN.test(reference.id))
  ) {
    return { ok: false, reason: "autoIdReference" };
  }
  if (start.spec.kind === "invalid")
    return { ok: false, reason: "invalidStart" };
  if (end.spec.kind === "invalid") return { ok: false, reason: "invalidEnd" };
  return {
    ok: true,
    task: {
      tags,
      tagsSpan,
      id: idField?.text ?? null,
      idSpan: idField?.span ?? null,
      start: start.spec,
      startSpan: startField?.span ?? null,
      startReferences: start.references,
      end: end.spec,
      endSpan: endField.span,
      endReferences: end.references,
      firstFieldStart: firstField.span.start,
    },
  };
}
