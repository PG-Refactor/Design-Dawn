import {
  classifyLines,
  type LineIssue,
  type SourceLine,
  scanLines,
} from "./source-lines";

// Diagram types of Mermaid 12.3.0, named by this app (not by Mermaid's internal ids).
// Several keywords can map to one type, for example `graph` and `flowchart`.
export type DiagramType =
  | "flowchart"
  | "sequence"
  | "pie"
  | "gantt"
  | "class"
  | "state"
  | "er"
  | "journey"
  | "mindmap"
  | "timeline"
  | "gitGraph"
  | "quadrantChart"
  | "xychart"
  | "sankey"
  | "requirement"
  | "c4"
  | "block"
  | "architecture"
  | "kanban"
  | "packet"
  | "radar"
  | "treemap"
  | "info"
  | "agentflow"
  | "swimlane"
  | "treeView"
  | "eventmodeling"
  | "ishikawa"
  | "venn"
  | "usecase"
  | "wardley"
  | "cynefin"
  | "railroad";

export interface DiagramKeyword {
  readonly keyword: string;
  readonly type: DiagramType;
  // Mermaid matches these keywords case-insensitively.
  readonly caseInsensitive?: true;
}

// Data only. The set was taken from the detector regular expressions in
// node_modules/mermaid 12.3.0 and each keyword was confirmed with `mermaid.parse` in
// diagram-type.real.dom.test.ts. Mermaid matches by prefix; this table needs a whole token
// instead, so a typo such as `graphX` is "unknown" here even if Mermaid would accept it.
export const DIAGRAM_KEYWORDS: readonly DiagramKeyword[] = [
  { keyword: "flowchart", type: "flowchart" },
  { keyword: "flowchart-elk", type: "flowchart" },
  { keyword: "graph", type: "flowchart" },
  { keyword: "sequenceDiagram", type: "sequence" },
  { keyword: "pie", type: "pie" },
  { keyword: "gantt", type: "gantt" },
  { keyword: "classDiagram", type: "class" },
  { keyword: "classDiagram-v2", type: "class" },
  { keyword: "stateDiagram", type: "state" },
  { keyword: "stateDiagram-v2", type: "state" },
  { keyword: "erDiagram", type: "er" },
  { keyword: "journey", type: "journey" },
  { keyword: "mindmap", type: "mindmap" },
  { keyword: "timeline", type: "timeline" },
  { keyword: "gitGraph", type: "gitGraph" },
  { keyword: "quadrantChart", type: "quadrantChart" },
  { keyword: "xychart", type: "xychart" },
  { keyword: "xychart-beta", type: "xychart" },
  { keyword: "sankey", type: "sankey" },
  { keyword: "sankey-beta", type: "sankey" },
  { keyword: "requirementDiagram", type: "requirement" },
  { keyword: "C4Context", type: "c4" },
  { keyword: "C4Container", type: "c4" },
  { keyword: "C4Component", type: "c4" },
  { keyword: "C4Dynamic", type: "c4" },
  { keyword: "C4Deployment", type: "c4" },
  { keyword: "block", type: "block" },
  { keyword: "block-beta", type: "block" },
  { keyword: "architecture-beta", type: "architecture" },
  { keyword: "kanban", type: "kanban" },
  { keyword: "packet", type: "packet" },
  { keyword: "packet-beta", type: "packet" },
  { keyword: "radar-beta", type: "radar" },
  { keyword: "treemap", type: "treemap" },
  { keyword: "treemap-beta", type: "treemap" },
  { keyword: "info", type: "info" },
  { keyword: "agentflow-beta", type: "agentflow" },
  { keyword: "swimlane-beta", type: "swimlane" },
  { keyword: "treeView-beta", type: "treeView" },
  { keyword: "eventmodeling", type: "eventmodeling" },
  { keyword: "ishikawa", type: "ishikawa", caseInsensitive: true },
  { keyword: "ishikawa-beta", type: "ishikawa", caseInsensitive: true },
  { keyword: "venn-beta", type: "venn" },
  { keyword: "usecase-beta", type: "usecase" },
  { keyword: "wardley-beta", type: "wardley", caseInsensitive: true },
  { keyword: "cynefin-beta", type: "cynefin" },
  { keyword: "railroad-beta", type: "railroad", caseInsensitive: true },
];

export type UnknownDiagramReason = "unknownKeyword" | LineIssue;

export type DiagramTypeDetection =
  | {
      readonly kind: "known";
      readonly type: DiagramType;
      readonly keyword: string;
      // The line that holds the keyword, and the keyword's own range in the source.
      readonly headerLine: SourceLine;
      readonly keywordStart: number;
      readonly keywordEnd: number;
    }
  | { readonly kind: "unknown"; readonly reason: UnknownDiagramReason }
  | { readonly kind: "empty" };

const WHITESPACE_PATTERN = /\s/;

function findKeyword(token: string): DiagramKeyword | undefined {
  return DIAGRAM_KEYWORDS.find((entry) =>
    entry.caseInsensitive === true
      ? entry.keyword.toLowerCase() === token.toLowerCase()
      : entry.keyword === token,
  );
}

// Reads the first token of the header line. The line is not trimmed in place: the offsets
// returned point into the original string.
function readHeaderToken(line: SourceLine): {
  readonly token: string;
  readonly start: number;
  readonly end: number;
} {
  let offset = 0;
  while (
    offset < line.text.length &&
    WHITESPACE_PATTERN.test(line.text[offset] ?? "")
  ) {
    offset += 1;
  }
  let tokenEnd = offset;
  while (
    tokenEnd < line.text.length &&
    !WHITESPACE_PATTERN.test(line.text[tokenEnd] ?? "")
  ) {
    tokenEnd += 1;
  }
  return {
    token: line.text.slice(offset, tokenEnd),
    start: line.start + offset,
    end: line.start + tokenEnd,
  };
}

export function detectDiagramType(source: string): DiagramTypeDetection {
  const { lines, issues } = classifyLines(scanLines(source));
  // Never guess past a structure that could not be read to its end.
  const [firstIssue] = issues;
  if (firstIssue !== undefined) {
    return { kind: "unknown", reason: firstIssue };
  }
  const header = lines.find((line) => line.kind === "header");
  if (header === undefined) return { kind: "empty" };
  const { token, start, end } = readHeaderToken(header);
  const entry = findKeyword(token);
  if (entry === undefined) return { kind: "unknown", reason: "unknownKeyword" };
  return {
    kind: "known",
    type: entry.type,
    keyword: token,
    headerLine: header,
    keywordStart: start,
    keywordEnd: end,
  };
}
