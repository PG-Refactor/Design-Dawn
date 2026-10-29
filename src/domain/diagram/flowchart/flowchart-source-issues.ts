import { hasLoneCarriageReturn, hasMarkupRewrite } from "../pie/pie-text";
import type { ClassifiedLine } from "../source-lines";
import {
  FLOWCHART_DIRECTIVE_MARK,
  FLOWCHART_STYLE_LIKE_PATTERNS,
} from "./flowchart-config";
import type { FlowchartSourceIssue } from "./flowchart-types";

// Mermaid rewrites the text before it parses it (`Diagram.fromText`: cleanupText,
// removeDirectives, cleanupComments, encodeEntities). Where that rewrite could change what a
// line means, the line-based reading is not trustworthy and the diagram is not editable.
// The rewrite rules are shared with the pie reader (pie-text.ts) where they are the same.

interface StyleLikeMatch {
  // Offset, inside the line, of the `;` that encodeEntities deletes.
  readonly semicolonAt: number;
  // True when only blanks follow: the `;` then merely ends its statement.
  readonly harmless: boolean;
}

function findStyleLikeMatches(lineText: string): readonly StyleLikeMatch[] {
  const matches: StyleLikeMatch[] = [];
  for (const pattern of FLOWCHART_STYLE_LIKE_PATTERNS) {
    pattern.lastIndex = 0;
    for (
      let match = pattern.exec(lineText);
      match !== null;
      match = pattern.exec(lineText)
    ) {
      const semicolonAt = match.index + match[0].length - 1;
      matches.push({
        semicolonAt,
        harmless: lineText.slice(semicolonAt + 1).trim() === "",
      });
    }
    pattern.lastIndex = 0;
  }
  return matches;
}

// Offsets (inside the line) of the `;` that Mermaid deletes but that only ended their
// statement. The statement splitter must still treat them as separators.
export function harmlessTerminatorOffsets(
  lineText: string,
): ReadonlySet<number> {
  return new Set(
    findStyleLikeMatches(lineText)
      .filter((match) => match.harmless)
      .map((match) => match.semicolonAt),
  );
}

const TEXT_REWRITTEN_KINDS: ReadonlySet<ClassifiedLine["kind"]> = new Set([
  "header",
  "statement",
]);

export function findFlowchartSourceIssues(
  source: string,
  lines: readonly ClassifiedLine[],
): readonly FlowchartSourceIssue[] {
  const issues: FlowchartSourceIssue[] = [];
  if (hasLoneCarriageReturn(source)) {
    issues.push({
      code: "loneCarriageReturn",
      lineIndexes: lines
        .filter((line) => line.text.includes("\r"))
        .map((line) => line.index),
    });
  }
  if (hasMarkupRewrite(source)) {
    issues.push({ code: "markupRewrite", lineIndexes: [] });
  }
  const styleLike = lines.filter(
    (line) =>
      TEXT_REWRITTEN_KINDS.has(line.kind) &&
      findStyleLikeMatches(line.text).some((match) => !match.harmless),
  );
  if (styleLike.length > 0) {
    issues.push({
      code: "styleLikeText",
      lineIndexes: styleLike.map((line) => line.index),
    });
  }
  // A directive anywhere but on a line of its own is removed (and applied) by Mermaid
  // before parsing, so the line is not what it parses. Front matter is cut out first and
  // keeps its text.
  const inlineDirective = lines.filter((line) => {
    if (line.kind === "frontMatter") return false;
    const occurrences = line.text.split(FLOWCHART_DIRECTIVE_MARK).length - 1;
    return line.kind === "directive" ? occurrences > 1 : occurrences > 0;
  });
  if (inlineDirective.length > 0) {
    issues.push({
      code: "inlineDirective",
      lineIndexes: inlineDirective.map((line) => line.index),
    });
  }
  return issues;
}

// Mermaid refuses a text whose front matter is not YAML or whose directive it cannot take
// apart, but the reader has no YAML parser. It accepts only the plain shapes the app and its
// fixtures use and calls anything else an unreadable structure.
export type FlowchartContentIssue =
  | "unreadableFrontMatter"
  | "unreadableDirective";

const FRONT_MATTER_KEY_LINE =
  /^( *)([A-Za-z_][A-Za-z0-9_-]*):(?: ([A-Za-z0-9_.][A-Za-z0-9 _.,/+-]*))?$/;
const FRONT_MATTER_INDENT_STEP = 2;
const DIRECTIVE_LINE = /^%%\{\s*(?:init|initialize)\s*:\s*(\{.*\})\s*\}%%$/;

function isReadableFrontMatter(bodyLines: readonly string[]): boolean {
  const keysByLevel: Set<string>[] = [new Set()];
  let previousIndent = 0;
  let previousHadValue = true;
  for (const text of bodyLines) {
    if (text.trim() === "") continue;
    const match = FRONT_MATTER_KEY_LINE.exec(text.trimEnd());
    if (match === null) return false;
    const indent = (match[1] as string).length;
    const key = match[2] as string;
    const hasValue = match[3] !== undefined;
    if (indent % FRONT_MATTER_INDENT_STEP !== 0) return false;
    const level = indent / FRONT_MATTER_INDENT_STEP;
    if (indent > previousIndent) {
      if (
        previousHadValue ||
        indent !== previousIndent + FRONT_MATTER_INDENT_STEP
      ) {
        return false;
      }
      keysByLevel[level] = new Set();
    } else {
      keysByLevel.length = level + 1;
      if (keysByLevel[level] === undefined) return false;
    }
    const keys = keysByLevel[level] as Set<string>;
    if (keys.has(key)) return false;
    keys.add(key);
    previousIndent = indent;
    previousHadValue = hasValue;
  }
  return true;
}

export function findFlowchartContentIssues(
  lines: readonly ClassifiedLine[],
): readonly FlowchartContentIssue[] {
  const issues = new Set<FlowchartContentIssue>();
  const frontMatter = lines.filter((line) => line.kind === "frontMatter");
  if (frontMatter.length >= 2) {
    const body = frontMatter.slice(1, -1).map((line) => line.text);
    if (!isReadableFrontMatter(body)) issues.add("unreadableFrontMatter");
  }
  for (const line of lines) {
    if (line.kind !== "directive") continue;
    const match = DIRECTIVE_LINE.exec(line.text.trim());
    let readable = false;
    if (match !== null) {
      try {
        readable = typeof JSON.parse(match[1] as string) === "object";
      } catch {
        readable = false;
      }
    }
    if (!readable) issues.add("unreadableDirective");
  }
  return [...issues];
}
