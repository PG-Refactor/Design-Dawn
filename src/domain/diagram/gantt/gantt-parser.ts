import { type DiagramTypeDetection, detectDiagramType } from "../diagram-type";
import { findFlowchartContentIssues } from "../flowchart/flowchart-source-issues";
import { hasLoneCarriageReturn, hasMarkupRewrite } from "../pie/pie-text";
import { type ClassifiedLine, classifyLines, scanLines } from "../source-lines";
import {
  GANTT_ACCESSIBILITY_PATTERN,
  GANTT_BARE_KEYWORD_PATTERN,
  GANTT_CLICK_PATTERN,
  GANTT_COMMENT_MARK,
  GANTT_DIRECTIVE_MARK,
  GANTT_HEADER_KEYWORD,
  GANTT_INCLUSIVE_END_DATES_PATTERN,
  GANTT_KEYWORD_LED_PATTERN,
  GANTT_MAX_SOURCE_LENGTH,
  GANTT_OTHER_CLICK_PATTERN,
  GANTT_SETTING_PATTERN,
  GANTT_TITLE_PATTERN,
  GANTT_TOP_AXIS_PATTERN,
  GANTT_WEEKDAY_PATTERN,
  GANTT_WEEKEND_PATTERN,
  type GanttDateFormat,
  type GanttSettingKeyword,
} from "./gantt-config";
import { asGanttDateFormat } from "./gantt-date";
import { parseTaskData } from "./gantt-task-parser";
import { hasCommentMarkWord, hasUnusualCharacter } from "./gantt-text";
import type {
  GanttClick,
  GanttLine,
  GanttLineKind,
  GanttReference,
  GanttSection,
  GanttSetting,
  GanttSourceIssue,
  GanttTaskEntry,
  GanttTitle,
  GanttUnsupportedLine,
  GanttUnsupportedReason,
  ParsedGantt,
} from "./gantt-types";

// Lossless line-level parse of a Mermaid gantt chart. Nothing is trimmed or rewritten: every
// piece an operation may change carries its absolute range (UTF-16 offsets into `source`).
// A line the reader cannot account for exactly is `unsupported`, and the chart is then
// read-only as a whole (gantt-editability.ts); the grammar evidence is in
// docs/architecture.md §16.17.

const BLANK_PATTERN = /^[\t ]*$/;
// Any whitespace or control character other than a blank and a tab: Mermaid's lexer treats
// several of them as separators, so the line cannot be read reliably.
const VALUE_FORBIDDEN_PATTERN = /[#;]/;
const COMMENT_START = "%";
const TASK_SEPARATOR = ":";

type MutableLine = { -readonly [Key in keyof GanttLine]: GanttLine[Key] };

function leadingBlanks(text: string): number {
  return text.length - text.trimStart().length;
}

function findDateFormat(lines: readonly ClassifiedLine[]): {
  readonly format: GanttDateFormat | null;
  readonly count: number;
} {
  let last: string | null = null;
  let count = 0;
  for (const line of lines) {
    if (line.kind !== "statement") continue;
    const match = GANTT_SETTING_PATTERN.exec(line.text.trimStart());
    if (match !== null && (match[1] as string).toLowerCase() === "dateformat") {
      last = match[2] as string;
      count += 1;
    }
  }
  return { format: last === null ? null : asGanttDateFormat(last), count };
}

export function parseGantt(source: string): ParsedGantt {
  const detection: DiagramTypeDetection = detectDiagramType(source);
  const classification = classifyLines(scanLines(source));
  const classified = classification.lines;
  const lines: MutableLine[] = classified.map((line) => ({
    index: line.index,
    start: line.start,
    end: line.end,
    terminator: line.terminator,
    text: line.text,
    kind: "unsupported",
  }));
  const isGantt = detection.kind === "known" && detection.type === "gantt";
  const titles: GanttTitle[] = [];
  const sections: GanttSection[] = [];
  const tasks: GanttTaskEntry[] = [];
  const clicks: GanttClick[] = [];
  const settings: GanttSetting[] = [];
  const unsupported: GanttUnsupportedLine[] = [];
  const dateFormat = isGantt
    ? findDateFormat(classified)
    : { format: null, count: 0 };

  const setKind = (index: number, kind: GanttLineKind) => {
    (lines[index] as MutableLine).kind = kind;
  };
  const refuse = (index: number, reason: GanttUnsupportedReason) => {
    setKind(index, "unsupported");
    unsupported.push({ lineIndex: index, reason });
  };

  const parseStatement = (line: ClassifiedLine) => {
    const index = line.index;
    const lead = leadingBlanks(line.text);
    const text = line.text.slice(lead);
    const base = line.start + lead;
    const trimmed = text.trim();
    if (trimmed === "") {
      setKind(index, "blank");
      return;
    }
    if (trimmed.startsWith(COMMENT_START)) {
      setKind(index, "comment");
      return;
    }
    if (hasUnusualCharacter(line.text)) {
      refuse(index, "nonAsciiWhitespace");
      return;
    }
    if (line.text.includes(GANTT_DIRECTIVE_MARK)) {
      refuse(index, "inlineDirective");
      return;
    }
    const setting = GANTT_SETTING_PATTERN.exec(text);
    if (setting !== null) {
      const keyword = (
        setting[1] as string
      ).toLowerCase() as GanttSettingKeyword;
      const value = setting[2] as string;
      if (value.trim() === "") return refuse(index, "emptyDirectiveValue");
      const allowsHash = keyword === "todaymarker";
      if (value.includes(";") || (!allowsHash && value.includes("#"))) {
        return refuse(index, "specialCharacter");
      }
      if (value.includes(GANTT_COMMENT_MARK))
        return refuse(index, "specialCharacter");
      settings.push({ lineIndex: index, keyword, value: value.trim() });
      return setKind(index, "setting");
    }
    const weekday = GANTT_WEEKDAY_PATTERN.exec(text);
    if (weekday !== null) {
      settings.push({
        lineIndex: index,
        keyword: "weekday",
        value: (weekday[1] as string).toLowerCase(),
      });
      return setKind(index, "setting");
    }
    const weekend = GANTT_WEEKEND_PATTERN.exec(text);
    if (weekend !== null) {
      settings.push({
        lineIndex: index,
        keyword: "weekend",
        value: (weekend[1] as string).toLowerCase(),
      });
      return setKind(index, "setting");
    }
    if (GANTT_INCLUSIVE_END_DATES_PATTERN.test(text)) {
      settings.push({
        lineIndex: index,
        keyword: "inclusiveenddates",
        value: "",
      });
      return setKind(index, "setting");
    }
    if (GANTT_TOP_AXIS_PATTERN.test(text)) return refuse(index, "topAxis");
    const named = GANTT_TITLE_PATTERN.exec(text);
    if (named !== null) {
      return parseNamed(line, base, named[1] as string, named[2] as string);
    }
    if (GANTT_ACCESSIBILITY_PATTERN.test(text))
      return refuse(index, "accessibility");
    const click = GANTT_CLICK_PATTERN.exec(text);
    if (click !== null) return parseClick(line, base, click);
    if (GANTT_OTHER_CLICK_PATTERN.test(text)) return refuse(index, "clickForm");
    if (GANTT_KEYWORD_LED_PATTERN.test(text))
      return refuse(index, "keywordLedName");
    if (GANTT_BARE_KEYWORD_PATTERN.test(text)) {
      return refuse(index, "emptyDirectiveValue");
    }
    parseTask(line, lead);
  };

  const parseNamed = (
    line: ClassifiedLine,
    base: number,
    keyword: string,
    value: string,
  ) => {
    const index = line.index;
    if (value.trim() === "") return refuse(index, "emptyDirectiveValue");
    if (value !== value.trim()) return refuse(index, "untrimmedText");
    if (
      VALUE_FORBIDDEN_PATTERN.test(value) ||
      value.includes(GANTT_COMMENT_MARK)
    ) {
      return refuse(index, "specialCharacter");
    }
    const valueStart = base + keyword.length + 1;
    const nameSpan = { start: valueStart, end: valueStart + value.length };
    if (keyword.toLowerCase() === "title") {
      titles.push({
        lineIndex: index,
        keywordSpan: { start: base, end: base + keyword.length },
        text: value,
        textSpan: nameSpan,
      });
      return setKind(index, "title");
    }
    sections.push({ lineIndex: index, name: value, nameSpan });
    setKind(index, "section");
  };

  const parseClick = (
    line: ClassifiedLine,
    base: number,
    match: RegExpExecArray,
  ) => {
    const index = line.index;
    const idsText = match[1] as string;
    const url = match[2] as string;
    if (/[#;%]/.test(url)) return refuse(index, "specialCharacter");
    const idsStart = base + match[0].indexOf(idsText, "click".length);
    const references: GanttReference[] = [];
    let offset = 0;
    for (const id of idsText.split(",")) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return refuse(index, "clickReference");
      const start = idsStart + offset;
      references.push({ id, span: { start, end: start + id.length } });
      offset += id.length + 1;
    }
    clicks.push({ lineIndex: index, references, url });
    setKind(index, "click");
  };

  const parseTask = (line: ClassifiedLine, lead: number) => {
    const index = line.index;
    if (hasCommentMarkWord(line.text)) return refuse(index, "commentMark");
    const colonAt = line.text.indexOf(TASK_SEPARATOR);
    if (colonAt === -1) return refuse(index, "notATask");
    const nameText = line.text.slice(lead, colonAt);
    const name = nameText.trim();
    if (name === "") return refuse(index, "emptyTaskName");
    if (VALUE_FORBIDDEN_PATTERN.test(name))
      return refuse(index, "specialCharacter");
    const data = line.text.slice(colonAt + 1);
    if (data.trim() === "") return refuse(index, "emptyTaskData");
    if (/[#;%]/.test(data)) return refuse(index, "specialCharacter");
    const parsed = parseTaskData(
      data,
      line.start + colonAt + 1,
      dateFormat.format,
    );
    if (!parsed.ok) return refuse(index, parsed.reason);
    const nameStart = line.start + lead;
    tasks.push({
      lineIndex: index,
      sectionIndex: sections.length - 1,
      name,
      nameSpan: { start: nameStart, end: nameStart + name.length },
      ...parsed.task,
    });
    setKind(index, "task");
  };

  if (isGantt) {
    for (const line of classified) {
      switch (line.kind) {
        case "frontMatter":
          setKind(line.index, "frontMatter");
          break;
        case "directive":
          setKind(line.index, "directive");
          break;
        case "blank":
          if (BLANK_PATTERN.test(line.text)) setKind(line.index, "blank");
          else refuse(line.index, "nonAsciiWhitespace");
          break;
        case "comment":
          setKind(line.index, "comment");
          break;
        case "header":
          if (
            new RegExp(`^[\\t ]*${GANTT_HEADER_KEYWORD}[\\t ]*$`).test(
              line.text,
            )
          ) {
            setKind(line.index, "header");
          } else {
            refuse(line.index, "headerLine");
          }
          break;
        case "statement":
          parseStatement(line);
          break;
      }
    }
  }

  // Clicks bind to a task defined before them; the others are ignored by Mermaid, so a
  // click that names an unknown id would start to work when a task gets that id.
  const seenIds = new Set<string>();
  const clickedIds = new Set<string>();
  const clickEntries = new Map(clicks.map((click) => [click.lineIndex, click]));
  const taskByLine = new Map(tasks.map((task) => [task.lineIndex, task]));
  for (const line of lines) {
    const task = taskByLine.get(line.index);
    if (task?.id != null) seenIds.add(task.id);
    const click = clickEntries.get(line.index);
    if (click === undefined) continue;
    const known = click.references.every(
      (reference) => seenIds.has(reference.id) && !clickedIds.has(reference.id),
    );
    if (!known) refuse(line.index, "clickReference");
    for (const reference of click.references) clickedIds.add(reference.id);
  }
  const validClicks = clicks.filter(
    (click) => (lines[click.lineIndex] as MutableLine).kind === "click",
  );

  return {
    source,
    detection,
    structureIssues: classification.issues,
    isGantt,
    lines,
    titles,
    sections,
    tasks,
    clicks: validClicks,
    settings,
    dateFormat: dateFormat.format,
    dateFormatCount: dateFormat.count,
    unsupported: unsupported.sort((a, b) => a.lineIndex - b.lineIndex),
    sourceIssues: isGantt ? findSourceIssues(source, classified) : [],
  };
}

function findSourceIssues(
  source: string,
  lines: readonly ClassifiedLine[],
): readonly GanttSourceIssue[] {
  const issues: GanttSourceIssue[] = [];
  if (hasLoneCarriageReturn(source)) {
    issues.push({ code: "loneCarriageReturn", lineIndexes: [] });
  }
  if (hasMarkupRewrite(source)) {
    issues.push({ code: "markupRewrite", lineIndexes: [] });
  }
  if (source.length > GANTT_MAX_SOURCE_LENGTH) {
    issues.push({ code: "tooLong", lineIndexes: [] });
  }
  // A directive anywhere but on a line of its own is removed (and applied) by Mermaid
  // before parsing; front matter is cut out first and keeps its text.
  const inlineDirective = lines.filter((line) => {
    if (line.kind === "frontMatter") return false;
    const occurrences = line.text.split(GANTT_DIRECTIVE_MARK).length - 1;
    return line.kind === "directive" ? occurrences > 1 : occurrences > 0;
  });
  if (inlineDirective.length > 0) {
    issues.push({
      code: "inlineDirective",
      lineIndexes: inlineDirective.map((line) => line.index),
    });
  }
  for (const content of findFlowchartContentIssues(lines)) {
    issues.push({ code: content, lineIndexes: [] });
  }
  return issues;
}
