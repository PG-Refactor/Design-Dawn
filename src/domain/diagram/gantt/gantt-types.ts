import type { DiagramTypeDetection } from "../diagram-type";
import type { LineIssue } from "../source-lines";
import type {
  GanttDateFormat,
  GanttSettingKeyword,
  GanttTag,
} from "./gantt-config";

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export type GanttLineKind =
  | "blank"
  | "comment"
  | "directive"
  | "frontMatter"
  | "header"
  | "title"
  | "section"
  | "task"
  | "click"
  | "setting"
  | "unsupported";

export interface GanttLine {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly terminator: "" | "\n" | "\r\n";
  readonly text: string;
  readonly kind: GanttLineKind;
}

// Valid specs, as the meaning holds them. `after` / `until` hold ids, never dates.
export type GanttStart =
  | { readonly kind: "implicit" }
  | { readonly kind: "date"; readonly text: string }
  | { readonly kind: "after"; readonly ids: readonly string[] };

export type GanttEnd =
  | { readonly kind: "duration"; readonly text: string }
  | { readonly kind: "date"; readonly text: string }
  | { readonly kind: "until"; readonly ids: readonly string[] };

export interface InvalidSpec {
  readonly kind: "invalid";
  readonly text: string;
}

export interface GanttReference {
  readonly id: string;
  readonly span: TextSpan;
}

export interface GanttTitle {
  readonly lineIndex: number;
  readonly keywordSpan: TextSpan;
  readonly text: string;
  readonly textSpan: TextSpan;
}

export interface GanttSection {
  readonly lineIndex: number;
  readonly name: string;
  readonly nameSpan: TextSpan;
}

export interface GanttSetting {
  readonly lineIndex: number;
  readonly keyword: GanttSettingKeyword;
  // Trimmed, and in lower case for `weekday` / `weekend`; empty for `inclusiveEndDates`.
  readonly value: string;
}

export interface GanttTaskEntry {
  readonly lineIndex: number;
  // Index into `sections`, or -1 before the first `section`.
  readonly sectionIndex: number;
  readonly name: string;
  readonly nameSpan: TextSpan;
  readonly tags: readonly GanttTag[];
  // From the first data field to the first field after the tags (empty when there are no
  // tags): the range a tag edit replaces.
  readonly tagsSpan: TextSpan;
  readonly id: string | null;
  readonly idSpan: TextSpan | null;
  readonly start: GanttStart | InvalidSpec;
  // Null for an implicit start. Otherwise the trimmed text of the start field.
  readonly startSpan: TextSpan | null;
  readonly startReferences: readonly GanttReference[];
  readonly end: GanttEnd | InvalidSpec;
  readonly endSpan: TextSpan;
  readonly endReferences: readonly GanttReference[];
  // Where the first field that is not a tag starts: where an id or a start is inserted.
  readonly firstFieldStart: number;
}

export interface GanttClick {
  readonly lineIndex: number;
  readonly references: readonly GanttReference[];
  readonly url: string;
}

export type GanttUnsupportedReason =
  | "headerLine"
  | "nonAsciiWhitespace"
  | "inlineDirective"
  | "emptyDirectiveValue"
  | "specialCharacter"
  | "untrimmedText"
  | "topAxis"
  | "accessibility"
  | "clickForm"
  | "clickReference"
  | "keywordLedName"
  | "commentMark"
  | "notATask"
  | "emptyTaskName"
  | "emptyTaskData"
  | "emptyField"
  | "duplicateTag"
  | "tooManyFields"
  | "noDataAfterTags"
  | "invalidId"
  | "autoIdShape"
  | "autoIdReference"
  | "invalidStart"
  | "invalidEnd";

export interface GanttUnsupportedLine {
  readonly lineIndex: number;
  readonly reason: GanttUnsupportedReason;
}

export type GanttSourceIssueCode =
  | "loneCarriageReturn"
  | "markupRewrite"
  | "inlineDirective"
  | "unreadableFrontMatter"
  | "unreadableDirective"
  | "tooLong";

export interface GanttSourceIssue {
  readonly code: GanttSourceIssueCode;
  readonly lineIndexes: readonly number[];
}

export interface ParsedGantt {
  readonly source: string;
  readonly detection: DiagramTypeDetection;
  readonly structureIssues: readonly LineIssue[];
  readonly isGantt: boolean;
  readonly lines: readonly GanttLine[];
  readonly titles: readonly GanttTitle[];
  readonly sections: readonly GanttSection[];
  readonly tasks: readonly GanttTaskEntry[];
  readonly clicks: readonly GanttClick[];
  readonly settings: readonly GanttSetting[];
  // The last `dateFormat` line's value when it is one the editor supports, else null.
  readonly dateFormat: GanttDateFormat | null;
  readonly dateFormatCount: number;
  readonly unsupported: readonly GanttUnsupportedLine[];
  readonly sourceIssues: readonly GanttSourceIssue[];
}
