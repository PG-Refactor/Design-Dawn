import { type DiagramTypeDetection, detectDiagramType } from "../diagram-type";
import {
  type ClassifiedLine,
  classifyLines,
  type LineIssue,
  scanLines,
} from "../source-lines";
import {
  FLOWCHART_BARE_COMMENT_PATTERN,
  FLOWCHART_DEFAULT_DIRECTION,
  FLOWCHART_DETECTED_HEADER_KEYWORDS,
  FLOWCHART_DIRECTION_TOKENS,
  FLOWCHART_HEADER_KEYWORDS,
  FLOWCHART_MAX_EDGES,
  FLOWCHART_MAX_SOURCE_LENGTH,
  type FlowchartDirectionToken,
  type FlowchartHeaderKeyword,
  normalizeFlowchartDirection,
} from "./flowchart-config";
import type { FlowchartMeaning } from "./flowchart-meaning";
import { resolveFlowchart } from "./flowchart-resolver";
import { spanOf } from "./flowchart-scan";
import { type RawSegment, splitSegments } from "./flowchart-segments";
import {
  type FlowchartContentIssue,
  findFlowchartContentIssues,
  findFlowchartSourceIssues,
  harmlessTerminatorOffsets,
} from "./flowchart-source-issues";
import {
  type PendingStatement,
  parseSegment,
  type StraySeparator,
} from "./flowchart-statement-parser";
import type {
  FlowchartHeader,
  FlowchartLine,
  FlowchartOpaqueReason,
  FlowchartOpaqueStatement,
  FlowchartSourceIssue,
  FlowchartStatement,
  FlowchartToken,
} from "./flowchart-types";

// Lossless line-level reader of a Mermaid flowchart. Nothing is trimmed or rewritten: the
// source is only ever sliced, and every token carries its absolute span (UTF-16 offsets).
// What the reader does not fully understand becomes an opaque statement; `meaning` exists
// only when nothing at all is opaque and Mermaid's pre-parse rewriting cannot have changed
// the text, so a meaning is never partial.

export interface FlowchartReading {
  readonly source: string;
  readonly detection: DiagramTypeDetection;
  // Structure Mermaid cannot be trusted to read the same way (unterminated front matter,
  // a directive over several lines).
  readonly structureIssues: readonly (LineIssue | FlowchartContentIssue)[];
  // The header keyword is a flowchart one (also `flowchart-elk`, which is then refused as
  // an unsupported header so its line is shown).
  readonly isFlowchart: boolean;
  readonly lines: readonly FlowchartLine[];
  readonly header: FlowchartHeader | null;
  // The recognised statements in source order. When anything is opaque this is what could
  // be recognised statement by statement; checks that need the context of earlier
  // statements have not been applied.
  readonly statements: readonly FlowchartStatement[];
  readonly opaque: readonly FlowchartOpaqueStatement[];
  readonly sourceIssues: readonly FlowchartSourceIssue[];
  // Number of edges the text defines (0 when the source is too long to be read).
  readonly edgeCount: number;
  // `e1@` ids written on links, in source order, repeats included.
  readonly declaredEdgeIds: readonly string[];
  readonly meaning: FlowchartMeaning | null;
}

// The `d` flag gives the offsets of the groups: keyword, direction, and the `;` that lets
// statements follow on the header line. Mermaid rejects `graph;` and `graph TD ;`, so the
// `;` is accepted only right behind a direction.
const HEADER_PATTERN = new RegExp(
  `^[ \\t]*(${FLOWCHART_HEADER_KEYWORDS.join("|")})(?:[ \\t]+(${FLOWCHART_DIRECTION_TOKENS.join("|")})(;)?)?`,
  "d",
);
const FIRST_TOKEN_PATTERN = /^[ \t]*([^\s;]+)/;

function firstHeaderToken(lines: readonly ClassifiedLine[]): string | null {
  const header = lines.find((line) => line.kind === "header");
  if (header === undefined) return null;
  return FIRST_TOKEN_PATTERN.exec(header.text)?.[1] ?? null;
}

function toReadingLine(line: ClassifiedLine): FlowchartLine {
  return {
    index: line.index,
    start: line.start,
    end: line.end,
    terminator: line.terminator,
    text: line.text,
    kind: line.kind,
  };
}

interface HeaderParse {
  readonly header: FlowchartHeader | null;
  // Where statements may start on the header line (after the `;`), or null.
  readonly statementsFrom: number | null;
  readonly opaque: FlowchartOpaqueStatement | null;
}

function parseHeader(line: ClassifiedLine): HeaderParse {
  const match = HEADER_PATTERN.exec(line.text);
  const terminated = match?.[3] !== undefined;
  if (
    match === null ||
    (!terminated && line.text.slice(match[0].length).trim() !== "")
  ) {
    const trimmedStart = line.text.length - line.text.trimStart().length;
    const text = line.text.trim();
    return {
      header: null,
      statementsFrom: null,
      opaque: {
        lineIndex: line.index,
        span: {
          start: line.start + trimmedStart,
          end: line.start + trimmedStart + text.length,
        },
        text,
        reason: "unsupportedHeader",
      },
    };
  }
  const scan = { text: line.text, base: line.start };
  const tokenAt = (
    range: readonly [number, number] | undefined,
  ): FlowchartToken | null =>
    range === undefined
      ? null
      : {
          text: line.text.slice(range[0], range[1]),
          span: spanOf(scan, range[0], range[1]),
        };
  const indices = match.indices;
  const keywordToken = tokenAt(indices?.[1]) as FlowchartToken;
  const directionToken = tokenAt(indices?.[2]);
  const directionValue = (directionToken?.text ??
    null) as FlowchartDirectionToken | null;
  return {
    header: {
      lineIndex: line.index,
      keyword: keywordToken.text as FlowchartHeaderKeyword,
      keywordToken,
      directionToken,
      directionValue,
      direction:
        directionValue === null
          ? FLOWCHART_DEFAULT_DIRECTION
          : normalizeFlowchartDirection(directionValue),
      terminator: tokenAt(indices?.[3]),
    },
    statementsFrom: terminated ? match[0].length : null,
    opaque: null,
  };
}

function opaqueOf(
  lineIndex: number,
  segmentText: string,
  start: number,
  reason: FlowchartOpaqueReason,
): FlowchartOpaqueStatement {
  return {
    lineIndex,
    span: { start, end: start + segmentText.length },
    text: segmentText,
    reason,
  };
}

// `subgraph S; A; end` on one line is read by Mermaid like the three-line form, but nothing
// that edits it later could place a change safely, so a subgraph header or `end` must have
// its line to itself.
const STRUCTURE_KINDS: ReadonlySet<string> = new Set([
  "subgraphStart",
  "subgraphEnd",
]);

function emptyReading(
  source: string,
  detection: DiagramTypeDetection,
  structureIssues: readonly (LineIssue | FlowchartContentIssue)[],
  isFlowchart: boolean,
  lines: readonly FlowchartLine[],
  sourceIssues: readonly FlowchartSourceIssue[],
): FlowchartReading {
  return {
    source,
    detection,
    structureIssues,
    isFlowchart,
    lines,
    header: null,
    statements: [],
    opaque: [],
    sourceIssues,
    edgeCount: 0,
    declaredEdgeIds: [],
    meaning: null,
  };
}

export function readFlowchart(source: string): FlowchartReading {
  const detection = detectDiagramType(source);
  const classification = classifyLines(scanLines(source));
  const classified = classification.lines;
  const lines = classified.map(toReadingLine);
  const headerToken = firstHeaderToken(classified);
  const isFlowchart =
    headerToken !== null &&
    (FLOWCHART_DETECTED_HEADER_KEYWORDS as readonly string[]).includes(
      headerToken,
    );
  const sourceIssues = findFlowchartSourceIssues(source, classified);
  const structureIssues = [
    ...classification.issues,
    ...findFlowchartContentIssues(classified),
  ];
  // An over-long source is refused as a whole; reading it would only produce a result no
  // one may act on.
  if (!isFlowchart || source.length > FLOWCHART_MAX_SOURCE_LENGTH) {
    return emptyReading(
      source,
      detection,
      structureIssues,
      isFlowchart,
      lines,
      sourceIssues,
    );
  }

  const opaque: FlowchartOpaqueStatement[] = [];
  const pending: (PendingStatement | StraySeparator)[] = [];
  let header: FlowchartHeader | null = null;

  for (const line of classified) {
    if (line.kind === "comment") {
      // Mermaid removes a comment line only when something follows the `%%`; a bare `%%`
      // is read as a node named `%%`.
      if (FLOWCHART_BARE_COMMENT_PATTERN.test(line.text)) {
        const text = line.text.trim();
        const start =
          line.start + (line.text.length - line.text.trimStart().length);
        opaque.push(opaqueOf(line.index, text, start, "bareCommentMark"));
      }
      continue;
    }
    if (line.kind !== "header" && line.kind !== "statement") continue;

    let from = 0;
    if (line.kind === "header") {
      const parsedHeader = parseHeader(line);
      header = parsedHeader.header;
      if (parsedHeader.opaque !== null) opaque.push(parsedHeader.opaque);
      if (parsedHeader.statementsFrom === null) continue;
      from = parsedHeader.statementsFrom;
    }

    const segments: readonly RawSegment[] = splitSegments(
      line.text,
      line.start,
      from,
      harmlessTerminatorOffsets(line.text),
    );
    const statementCount = segments.filter(
      (segment) => segment.flag !== "stray",
    ).length;
    for (const segment of segments) {
      const result = parseSegment(segment, line.index);
      if (!result.ok) {
        opaque.push(
          opaqueOf(line.index, segment.text, segment.start, result.reason),
        );
      } else if (
        STRUCTURE_KINDS.has(result.statement.kind) &&
        statementCount > 1
      ) {
        opaque.push(
          opaqueOf(
            line.index,
            segment.text,
            segment.start,
            "subgraphSharesLine",
          ),
        );
      } else {
        pending.push(result.statement);
      }
    }
  }

  const direction = header?.direction ?? FLOWCHART_DEFAULT_DIRECTION;
  const parseLevelClean = opaque.length === 0;
  if (!parseLevelClean) {
    return {
      source,
      detection,
      structureIssues: structureIssues,
      isFlowchart,
      lines,
      header,
      statements: pending
        .filter(
          (statement): statement is PendingStatement =>
            statement.kind !== "straySeparator",
        )
        .map(
          (statement, index) => ({ ...statement, index }) as FlowchartStatement,
        ),
      opaque: sortOpaque(opaque),
      sourceIssues,
      edgeCount: 0,
      declaredEdgeIds: [],
      meaning: null,
    };
  }

  const resolution = resolveFlowchart(pending, direction);
  const resolvedOpaque = resolution.refusals.map((refusal) =>
    opaqueOf(
      refusal.pending.lineIndex,
      refusal.pending.text,
      refusal.pending.span.start,
      refusal.reason,
    ),
  );
  const trustworthy =
    resolvedOpaque.length === 0 &&
    structureIssues.length === 0 &&
    sourceIssues.length === 0 &&
    resolution.edgeCount <= FLOWCHART_MAX_EDGES;
  return {
    source,
    detection,
    structureIssues: structureIssues,
    isFlowchart,
    lines,
    header,
    statements: resolution.statements,
    opaque: sortOpaque(resolvedOpaque),
    sourceIssues,
    edgeCount: resolution.edgeCount,
    declaredEdgeIds: resolution.declaredEdgeIds,
    meaning: trustworthy ? resolution.meaning : null,
  };
}

function sortOpaque(
  opaque: readonly FlowchartOpaqueStatement[],
): readonly FlowchartOpaqueStatement[] {
  return [...opaque].sort((left, right) => left.span.start - right.span.start);
}
