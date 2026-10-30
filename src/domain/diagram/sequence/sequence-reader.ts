import { type DiagramTypeDetection, detectDiagramType } from "../diagram-type";
import {
  type FlowchartContentIssue,
  findFlowchartContentIssues,
  findFlowchartSourceIssues,
} from "../flowchart/flowchart-source-issues";
import type { FlowchartSourceIssue } from "../flowchart/flowchart-types";
import {
  type ClassifiedLine,
  classifyLines,
  type LineIssue,
  scanLines,
} from "../source-lines";
import {
  SEQUENCE_COMMENT_MARK,
  SEQUENCE_ENTITY_MASK_CHARACTER,
  SEQUENCE_ENTITY_MASK_PATTERN,
  SEQUENCE_HASH_COMMENT_MARK,
  SEQUENCE_HEADER_KEYWORD,
  SEQUENCE_MAX_SOURCE_LENGTH,
  SEQUENCE_STATEMENT_PATTERNS,
  SEQUENCE_STATEMENT_SEPARATOR,
} from "./sequence-config";
import {
  buildSequenceMeaning,
  type SequenceInvalidReason,
  type SequenceMeaning,
} from "./sequence-meaning";
import { parseSequenceStatement } from "./sequence-statement-parser";
import type {
  SequenceOpaqueReason,
  SequenceOpaqueStatement,
  SequenceStatement,
} from "./sequence-types";

// Lossless line-level reader of a Mermaid sequence diagram. Nothing is trimmed or rewritten:
// the source is only ever sliced, and every token carries its absolute span (UTF-16
// offsets). What the reader does not fully understand becomes an opaque statement; `meaning`
// exists only when nothing at all is opaque and Mermaid's pre-parse rewriting cannot have
// changed the text, so a meaning is never partial.

export interface SequenceReading {
  readonly source: string;
  readonly detection: DiagramTypeDetection;
  readonly isSequence: boolean;
  // Structure Mermaid cannot be trusted to read the same way (unterminated front matter,
  // a directive over several lines, front matter or a directive of an unreadable shape).
  readonly structureIssues: readonly (LineIssue | FlowchartContentIssue)[];
  // Text that Mermaid rewrites before it reads it.
  readonly sourceIssues: readonly FlowchartSourceIssue[];
  readonly lines: readonly ClassifiedLine[];
  readonly headerLineIndex: number | null;
  readonly statements: readonly SequenceStatement[];
  readonly opaque: readonly SequenceOpaqueStatement[];
  // Set when every statement was understood but Mermaid would reject (or cannot draw) them.
  readonly invalid: {
    readonly reason: SequenceInvalidReason;
    readonly detail: string;
  } | null;
  readonly meaning: SequenceMeaning | null;
}

// The first word of the header line; `;` ends it, so `sequenceDiagram;` is the keyword with
// something behind it (which is then an opaque statement), not an unknown word.
const HEADER_PATTERN = /^\s*([^\s;]+)/;

function maskEntities(text: string): string {
  return text.replace(SEQUENCE_ENTITY_MASK_PATTERN, (entity) =>
    SEQUENCE_ENTITY_MASK_CHARACTER.repeat(entity.length),
  );
}

interface StatementPart {
  readonly text: string;
  readonly start: number;
}

// Cuts a line at its first `#` that does not begin an entity (a comment to the end of the
// line) and splits what is left at `;`. Entities such as `#59;` are masked first because
// their `;` is not a separator.
function splitLine(line: ClassifiedLine): {
  readonly parts: readonly StatementPart[];
  readonly hashAt: number;
} {
  const masked = maskEntities(line.text);
  const hashAt = masked.indexOf(SEQUENCE_HASH_COMMENT_MARK);
  const codeLength = hashAt === -1 ? line.text.length : hashAt;
  const parts: StatementPart[] = [];
  let from = 0;
  for (let at = 0; at <= codeLength; at += 1) {
    if (at === codeLength || masked[at] === SEQUENCE_STATEMENT_SEPARATOR) {
      parts.push({
        text: line.text.slice(from, at),
        start: line.start + from,
      });
      from = at + 1;
    }
  }
  return { parts, hashAt };
}

function emptyReading(
  source: string,
  detection: DiagramTypeDetection,
  isSequence: boolean,
  structureIssues: SequenceReading["structureIssues"],
  sourceIssues: readonly FlowchartSourceIssue[],
  lines: readonly ClassifiedLine[],
): SequenceReading {
  return {
    source,
    detection,
    isSequence,
    structureIssues,
    sourceIssues,
    lines,
    headerLineIndex: null,
    statements: [],
    opaque: [],
    invalid: null,
    meaning: null,
  };
}

export function readSequence(source: string): SequenceReading {
  const detection = detectDiagramType(source);
  const classification = classifyLines(scanLines(source));
  const lines = classification.lines;
  const header = lines.find((line) => line.kind === "header");
  const headerMatch =
    header === undefined ? null : HEADER_PATTERN.exec(header.text);
  // The header decides, not the detection: detection gives up on a structure it cannot read
  // (a directive over several lines), and that is a reason to show, not "not a sequence".
  const isSequence = headerMatch?.[1] === SEQUENCE_HEADER_KEYWORD;
  const sourceIssues = findFlowchartSourceIssues(source, lines);
  const structureIssues = [
    ...classification.issues,
    ...findFlowchartContentIssues(lines),
  ];
  // An over-long source is refused as a whole; reading it would only produce a result no one
  // may act on.
  if (!isSequence || source.length > SEQUENCE_MAX_SOURCE_LENGTH) {
    return emptyReading(
      source,
      detection,
      isSequence,
      structureIssues,
      sourceIssues,
      lines,
    );
  }

  const statements: SequenceStatement[] = [];
  const opaque: SequenceOpaqueStatement[] = [];
  const pushOpaque = (
    lineIndex: number,
    reason: SequenceOpaqueReason,
    text: string,
    start: number,
  ): void => {
    opaque.push({
      lineIndex,
      reason,
      text,
      span: { start, end: start + text.length },
    });
  };

  let headerLineIndex: number | null = null;
  for (const line of lines) {
    if (line.kind === "header") {
      headerLineIndex = line.index;
      const keywordEnd = headerMatch?.[0].length ?? 0;
      const rest = line.text.slice(keywordEnd);
      if (rest.trim() !== "") {
        const trimmed = rest.trim();
        pushOpaque(
          line.index,
          "statementOnHeaderLine",
          trimmed,
          line.start + keywordEnd + (rest.length - rest.trimStart().length),
        );
      }
      continue;
    }
    if (line.kind !== "statement") continue;
    const trimmedLine = line.text.trim();
    if (
      trimmedLine.startsWith(SEQUENCE_COMMENT_MARK) ||
      trimmedLine.startsWith(SEQUENCE_HASH_COMMENT_MARK)
    ) {
      continue;
    }
    const { parts, hashAt } = splitLine(line);
    // In a declaration Mermaid keeps `#` inside the id (and cuts an alias at it), so a `#`
    // there is not a comment and the line is not read.
    if (
      hashAt !== -1 &&
      SEQUENCE_STATEMENT_PATTERNS.declarationStart.test(line.text)
    ) {
      pushOpaque(
        line.index,
        "hashInDeclaration",
        trimmedLine,
        line.start + (line.text.length - line.text.trimStart().length),
      );
      continue;
    }
    for (const part of parts) {
      const text = part.text.trim();
      if (text === "") continue;
      // A comment starts at a token boundary and runs to the end of the line, `;` included.
      if (text.startsWith(SEQUENCE_COMMENT_MARK)) break;
      const start =
        part.start + (part.text.length - part.text.trimStart().length);
      const parsed = parseSequenceStatement({
        text,
        start,
        lineIndex: line.index,
        index: statements.length,
      });
      if (parsed.ok) statements.push(parsed.statement);
      else pushOpaque(line.index, parsed.reason, text, start);
    }
  }

  const readable =
    opaque.length === 0 &&
    sourceIssues.length === 0 &&
    structureIssues.length === 0;
  const built = readable ? buildSequenceMeaning(statements) : null;
  return {
    source,
    detection,
    isSequence,
    structureIssues,
    sourceIssues,
    lines,
    headerLineIndex,
    statements,
    opaque,
    invalid:
      built !== null && !built.ok
        ? { reason: built.reason, detail: built.detail }
        : null,
    meaning: built?.ok ? built.meaning : null,
  };
}
