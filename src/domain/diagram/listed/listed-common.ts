// What the ER, state and class diagram editors share. These diagrams are read line by line:
// each line is a statement the editor understands (an entity, a transition, a member ...),
// a comment or a blank line. A diagram with any other line is not editable (the GUI shows
// why and offers Source), so an edit can never drop something the editor did not read.
// Edits replace, insert or remove whole lines; everything else in the text stays as it is.

import { type DomainResult, err, ok } from "../../shared/domain-result";
import type { DiagramEditorAssessment } from "../diagram-source";
import {
  type ClassifiedLine,
  classifyLines,
  type LineRef,
  scanLines,
} from "../source-lines";
import type { TextEdit } from "../text-edit";

export const DEFAULT_INDENT = "    ";
const LINE_FEED = "\n";
const LEADING_WHITESPACE = /^\s*/;

// Names an editor accepts for an entity, a state or a class: what Mermaid reads as one word
// in every one of these grammars.
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const IDENTIFIER_SOURCE = "[A-Za-z_][A-Za-z0-9_]*";

export interface ReadLines {
  readonly lines: readonly ClassifiedLine[];
  // The statement lines after the header, in order.
  readonly statements: readonly ClassifiedLine[];
  readonly header: ClassifiedLine | null;
  // Front matter, directives or a structure issue: not edited by these editors.
  readonly structureProblem: boolean;
}

export function readLines(source: string): ReadLines {
  const classified = classifyLines(scanLines(source));
  const header =
    classified.lines.find((line) => line.kind === "header") ?? null;
  return {
    lines: classified.lines,
    statements: classified.lines.filter((line) => line.kind === "statement"),
    header,
    structureProblem:
      classified.issues.length > 0 ||
      classified.lines.some(
        (line) => line.kind === "frontMatter" || line.kind === "directive",
      ),
  };
}

export function lineRef(line: ClassifiedLine): LineRef {
  return { index: line.index, start: line.start, end: line.end };
}

// The indentation of the first statement, so new lines look like the old ones.
export function indentOf(read: ReadLines): string {
  const first = read.statements[0];
  return first === undefined
    ? DEFAULT_INDENT
    : (LEADING_WHITESPACE.exec(first.text)?.[0] ?? DEFAULT_INDENT);
}

export function leadingWhitespace(line: ClassifiedLine): string {
  return LEADING_WHITESPACE.exec(line.text)?.[0] ?? "";
}

export function replaceLine(line: ClassifiedLine, text: string): TextEdit {
  return { start: line.start, end: line.end, text };
}

// The whole line with its terminator; for the last line, the break before it instead, so
// no empty line is left behind.
export function removeLine(
  line: ClassifiedLine,
  lines: readonly ClassifiedLine[],
): TextEdit {
  if (line.terminator !== "") {
    return {
      start: line.start,
      end: line.end + line.terminator.length,
      text: "",
    };
  }
  const previous = lines[line.index - 1];
  return previous === undefined
    ? { start: line.start, end: line.end, text: "" }
    : { start: previous.end, end: line.end, text: "" };
}

// New lines after `line` (they take its terminator style; a last line gets a break first).
export function insertAfter(
  line: ClassifiedLine,
  texts: readonly string[],
): TextEdit {
  const terminator = line.terminator === "" ? LINE_FEED : line.terminator;
  const body = texts.join(terminator);
  return line.terminator === ""
    ? { start: line.end, end: line.end, text: `${terminator}${body}` }
    : {
        start: line.end + line.terminator.length,
        end: line.end + line.terminator.length,
        text: `${body}${terminator}`,
      };
}

// New lines at the end of the diagram.
export function append(
  read: ReadLines,
  texts: readonly string[],
): TextEdit | null {
  const last = read.lines[read.lines.length - 1];
  return last === undefined ? null : insertAfter(last, texts);
}

export function refuse<Value>(
  reason: string,
  detail: string,
): DomainResult<Value> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

export function requireIdentifier(
  name: string,
  what: string,
): DomainResult<string> {
  return IDENTIFIER_PATTERN.test(name)
    ? ok(name)
    : refuse("invalidName", `${what} ${JSON.stringify(name)}`);
}

// Text that must stay on one line and not contain `forbidden` characters.
export function requireText(
  text: string,
  what: string,
  forbidden: RegExp,
): DomainResult<string> {
  const trimmed = text.trim();
  if (/[\r\n]/.test(text) || forbidden.test(trimmed)) {
    return refuse("invalidText", what);
  }
  return ok(trimmed);
}

export function assessment(
  notReadable: {
    readonly reason: string;
    readonly lines: readonly LineRef[];
  } | null,
): DiagramEditorAssessment {
  return notReadable === null
    ? { editable: true }
    : {
        editable: false,
        reason: notReadable.reason,
        detail: notReadable.reason,
        unsupported: notReadable.lines,
      };
}

// The candidate must be editable and mean exactly what the operation promised.
export function verifyMeaning<Meaning>(
  candidate: { readonly editable: boolean; readonly meaning: Meaning },
  expected: Meaning,
): DomainResult<void> {
  if (!candidate.editable) {
    return err("diagramNotEditable", "the edited text is not readable");
  }
  return JSON.stringify(candidate.meaning) === JSON.stringify(expected)
    ? ok(undefined)
    : err("diagramMeaningMismatch", "the edited text means something else");
}
