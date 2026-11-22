// Class diagrams (`classDiagram`) for the GUI: classes with members, and relationships.
//
// Understood lines:
//   class Name                    a class without members
//   class Name {  ...  }          a class block; inside, one member per line, kept as written
//   Name : +member                a member written outside the block
//   A <|-- B : label              a relationship with one of RELATIONSHIP_ARROWS
//   direction LR                  kept as it is (not edited)
// Anything else (generics, namespaces, annotations outside a block, cardinalities, notes,
// styles ...) makes the diagram read-only in the GUI.

import { capturedText } from "../../shared/captured-text";
import { type DomainResult, ok } from "../../shared/domain-result";
import type { DiagramEditorEntry } from "../diagram-source";
import type { ClassifiedLine, LineRef } from "../source-lines";
import type { TextEdit } from "../text-edit";
import {
  append,
  assessment,
  IDENTIFIER_SOURCE,
  indentOf,
  insertAfter,
  leadingWhitespace,
  lineRef,
  type ReadLines,
  readLines,
  refuse,
  removeLine,
  replaceLine,
  requireIdentifier,
  requireText,
  verifyMeaning,
} from "./listed-common";

// The arrows the GUI offers, as written between the two class names.
export const CLASS_ARROWS = [
  "<|--",
  "*--",
  "o--",
  "-->",
  "--",
  "..>",
  "..|>",
  "..",
] as const;
export type ClassArrow = (typeof CLASS_ARROWS)[number];

export interface ClassItem {
  readonly name: string;
  // Each member as written (`+id: UUID`, `+save()`), without the indentation.
  readonly members: readonly string[];
}

export interface ClassRelationship {
  readonly from: string;
  // How many on each end (`1`, `*`, `0..1`); empty when not written.
  readonly fromCardinality: string;
  readonly arrow: ClassArrow;
  readonly toCardinality: string;
  readonly to: string;
  readonly label: string;
}

export interface ClassMeaning {
  readonly classes: readonly ClassItem[];
  readonly relationships: readonly ClassRelationship[];
}

interface MemberLine {
  readonly line: ClassifiedLine;
  // Written inside the block, or as `Name : member` outside it.
  readonly inBlock: boolean;
}

interface ClassLines {
  readonly name: string;
  readonly bare: ClassifiedLine | null;
  readonly open: ClassifiedLine | null;
  readonly close: ClassifiedLine | null;
  readonly members: readonly MemberLine[];
}

export interface ClassRead {
  readonly editable: boolean;
  readonly meaning: ClassMeaning;
  readonly notReadable: {
    readonly reason: string;
    readonly lines: readonly LineRef[];
  } | null;
  readonly read: ReadLines;
  readonly classLines: readonly ClassLines[];
  readonly relationshipLines: readonly ClassifiedLine[];
}

const HEADER = "classDiagram";
const NAME = `(${IDENTIFIER_SOURCE})`;
const BARE = new RegExp(`^\\s*class\\s+${NAME}\\s*$`);
const OPEN = new RegExp(`^\\s*class\\s+${NAME}\\s*\\{\\s*$`);
const CLOSE = /^\s*\}\s*$/;
const OUTSIDE_MEMBER = new RegExp(`^\\s*${NAME}\\s*:\\s*(.+?)\\s*$`);
// Longest first, so `..|>` is not read as `..`.
const ARROW = [...CLASS_ARROWS]
  .sort((left, right) => right.length - left.length)
  .map((arrow) => arrow.replace(/[|*.]/g, "\\$&"))
  .join("|");
const RELATIONSHIP = new RegExp(
  `^\\s*${NAME}\\s*(?:"([^"]*)"\\s*)?(${ARROW})\\s*(?:"([^"]*)"\\s*)?${NAME}\\s*(?::\\s*(.+?))?\\s*$`,
);
const DIRECTION = /^\s*direction\s+(?:LR|RL|TB|BT)\s*$/;
// Braces would open or close a block; a member must stay one line of its own.
const FORBIDDEN_MEMBER = /[{}]/;
const FORBIDDEN_LABEL = /[{}"]/;

// One class while reading: its lines and its members' texts, in the order they come.
interface ClassEntry {
  readonly name: string;
  bare: ClassifiedLine | null;
  open: ClassifiedLine | null;
  close: ClassifiedLine | null;
  readonly members: MemberLine[];
  readonly texts: string[];
}

export function readClass(source: string): ClassRead {
  const read = readLines(source);
  const unsupported: LineRef[] = [];
  // In the order the classes are first named.
  const entries = new Map<string, ClassEntry>();
  const relationships: ClassRelationship[] = [];
  const relationshipLines: ClassifiedLine[] = [];
  let reason: string | null = read.structureProblem ? "structureIssue" : null;
  if (read.header?.text.trim() !== HEADER) reason ??= "unsupportedLines";

  const classFor = (name: string): ClassEntry => {
    const existing = entries.get(name);
    if (existing !== undefined) return existing;
    const entry: ClassEntry = {
      name,
      bare: null,
      open: null,
      close: null,
      members: [],
      texts: [],
    };
    entries.set(name, entry);
    return entry;
  };
  const declaredTwice = (entry: ClassEntry) =>
    entry.bare !== null || entry.open !== null;

  // The class whose block is open, if any, and the line that opened it.
  let block: {
    readonly entry: ClassEntry;
    readonly open: ClassifiedLine;
  } | null = null;
  for (const line of read.statements) {
    if (block !== null) {
      if (CLOSE.test(line.text)) {
        block.entry.open = block.open;
        block.entry.close = line;
        block = null;
        continue;
      }
      const member = line.text.trim();
      if (FORBIDDEN_MEMBER.test(member)) {
        unsupported.push(lineRef(line));
        continue;
      }
      block.entry.texts.push(member);
      block.entry.members.push({ line, inBlock: true });
      continue;
    }
    const open = OPEN.exec(line.text);
    if (open !== null) {
      const entry = classFor(capturedText(open, 1));
      if (declaredTwice(entry)) unsupported.push(lineRef(line));
      block = { entry, open: line };
      continue;
    }
    const bare = BARE.exec(line.text);
    if (bare !== null) {
      const entry = classFor(capturedText(bare, 1));
      if (declaredTwice(entry)) unsupported.push(lineRef(line));
      entry.bare = line;
      continue;
    }
    const relationship = RELATIONSHIP.exec(line.text);
    if (relationship !== null) {
      const from = classFor(capturedText(relationship, 1)).name;
      const to = classFor(capturedText(relationship, 5)).name;
      relationships.push({
        from,
        fromCardinality: capturedText(relationship, 2),
        arrow: capturedText(relationship, 3) as ClassArrow,
        toCardinality: capturedText(relationship, 4),
        to,
        label: capturedText(relationship, 6),
      });
      relationshipLines.push(line);
      continue;
    }
    if (DIRECTION.test(line.text)) continue;
    const outside = OUTSIDE_MEMBER.exec(line.text);
    const outsideText = outside === null ? "" : capturedText(outside, 2);
    if (outside !== null && !FORBIDDEN_MEMBER.test(outsideText)) {
      const entry = classFor(capturedText(outside, 1));
      entry.texts.push(outsideText);
      entry.members.push({ line, inBlock: false });
      continue;
    }
    unsupported.push(lineRef(line));
  }
  // A block that is never closed.
  if (block !== null) unsupported.push(lineRef(block.open));
  if (unsupported.length > 0) reason ??= "unsupportedLines";
  const editable = reason === null;
  const classes = [...entries.values()];
  return {
    editable,
    meaning: {
      classes: classes.map((entry) => ({
        name: entry.name,
        members: entry.texts,
      })),
      relationships,
    },
    notReadable: reason === null ? null : { reason, lines: unsupported },
    read,
    classLines: classes.map((entry) => ({
      name: entry.name,
      bare: entry.bare,
      open: entry.open,
      close: entry.close,
      members: entry.members,
    })),
    relationshipLines,
  };
}

export function classRelationshipText(relationship: ClassRelationship): string {
  const label = relationship.label === "" ? "" : ` : ${relationship.label}`;
  const fromCardinality =
    relationship.fromCardinality === ""
      ? ""
      : ` "${relationship.fromCardinality}"`;
  const toCardinality =
    relationship.toCardinality === "" ? "" : `"${relationship.toCardinality}" `;
  return `${relationship.from}${fromCardinality} ${relationship.arrow} ${toCardinality}${relationship.to}${label}`;
}

export type ClassOperation =
  | { readonly kind: "addClass"; readonly name: string }
  | { readonly kind: "deleteClass"; readonly name: string }
  | {
      readonly kind: "addMember";
      readonly className: string;
      readonly member: string;
    }
  | {
      readonly kind: "updateMember";
      readonly className: string;
      readonly index: number;
      readonly member: string;
    }
  | {
      readonly kind: "deleteMember";
      readonly className: string;
      readonly index: number;
    }
  | {
      readonly kind: "addRelationship";
      readonly relationship: ClassRelationship;
    }
  | {
      readonly kind: "updateRelationship";
      readonly index: number;
      readonly relationship: ClassRelationship;
    }
  | { readonly kind: "deleteRelationship"; readonly index: number };

function checkMember(member: string): DomainResult<string> {
  const text = requireText(member, "member", FORBIDDEN_MEMBER);
  if (!text.ok) return text;
  return text.value === "" ? refuse("emptyText", "member") : text;
}

function checkRelationship(
  relationship: ClassRelationship,
): DomainResult<ClassRelationship> {
  const from = requireIdentifier(relationship.from, "class");
  if (!from.ok) return from;
  const to = requireIdentifier(relationship.to, "class");
  if (!to.ok) return to;
  if (!(CLASS_ARROWS as readonly string[]).includes(relationship.arrow)) {
    return refuse("invalidArrow", relationship.arrow);
  }
  const label = requireText(relationship.label, "label", FORBIDDEN_LABEL);
  if (!label.ok) return label;
  const fromCardinality = requireText(
    relationship.fromCardinality,
    "cardinality",
    FORBIDDEN_LABEL,
  );
  if (!fromCardinality.ok) return fromCardinality;
  const toCardinality = requireText(
    relationship.toCardinality,
    "cardinality",
    FORBIDDEN_LABEL,
  );
  if (!toCardinality.ok) return toCardinality;
  return ok({
    ...relationship,
    label: label.value,
    fromCardinality: fromCardinality.value,
    toCardinality: toCardinality.value,
  });
}

export interface ClassPlan {
  readonly edits: readonly TextEdit[];
  readonly expected: ClassMeaning;
}

function withRelationships(
  current: ClassRead,
  relationships: readonly ClassRelationship[],
): ClassMeaning {
  const kept = current.classLines
    .filter(
      (lines) =>
        lines.bare !== null || lines.open !== null || lines.members.length > 0,
    )
    .map((lines) => lines.name);
  const names = new Set([
    ...kept,
    ...relationships.flatMap((relationship) => [
      relationship.from,
      relationship.to,
    ]),
  ]);
  return {
    classes: [...names].map(
      (name) =>
        current.meaning.classes.find((item) => item.name === name) ?? {
          name,
          members: [],
        },
    ),
    relationships,
  };
}

function withMembers(
  meaning: ClassMeaning,
  className: string,
  change: (members: readonly string[]) => readonly string[],
): ClassMeaning {
  return {
    ...meaning,
    classes: meaning.classes.map((item) =>
      item.name === className
        ? { ...item, members: change(item.members) }
        : item,
    ),
  };
}

export function planClassOperation(
  source: string,
  operation: ClassOperation,
): DomainResult<ClassPlan> {
  const current = readClass(source);
  if (!current.editable) return refuse("notEditable", "the diagram");
  const { meaning, read } = current;
  const indent = indentOf(read);
  const classAt = (name: string) =>
    current.classLines.find((lines) => lines.name === name);
  const appendLines = (texts: readonly string[]): TextEdit =>
    append(read, texts);
  switch (operation.kind) {
    case "addClass": {
      const name = requireIdentifier(operation.name, "class");
      if (!name.ok) return name;
      if (classAt(name.value) !== undefined)
        return refuse("duplicateName", name.value);
      const edit = appendLines([`${indent}class ${name.value}`]);
      return ok({
        edits: [edit],
        expected: {
          ...meaning,
          classes: [...meaning.classes, { name: name.value, members: [] }],
        },
      });
    }
    case "deleteClass": {
      const lines = classAt(operation.name);
      if (lines === undefined) return refuse("unknownClass", operation.name);
      if (
        meaning.relationships.some(
          (relationship) =>
            relationship.from === operation.name ||
            relationship.to === operation.name,
        )
      ) {
        return refuse("classInUse", operation.name);
      }
      const removed = [
        lines.bare,
        lines.open,
        ...lines.members.map((member) => member.line),
        lines.close,
      ].filter((line): line is ClassifiedLine => line !== null);
      return ok({
        edits: removed.map((line) => removeLine(line, read.lines)),
        expected: {
          ...meaning,
          classes: meaning.classes.filter(
            (item) => item.name !== operation.name,
          ),
        },
      });
    }
    case "addMember": {
      const lines = classAt(operation.className);
      if (lines === undefined)
        return refuse("unknownClass", operation.className);
      const member = checkMember(operation.member);
      if (!member.ok) return member;
      const lastInBlock = [...lines.members]
        .reverse()
        .find((entry) => entry.inBlock);
      let edit: TextEdit;
      if (lines.open !== null && lines.close !== null) {
        const after = lastInBlock?.line ?? lines.open;
        const memberIndent =
          lastInBlock === undefined
            ? `${leadingWhitespace(lines.open)}${indent}`
            : leadingWhitespace(lastInBlock.line);
        edit = insertAfter(after, [`${memberIndent}${member.value}`]);
      } else {
        // No block: a member line outside it, which needs no change to the class line.
        edit = appendLines([`${indent}${lines.name} : ${member.value}`]);
      }
      return ok({
        edits: [edit],
        expected: withMembers(meaning, lines.name, (existing) => [
          ...existing,
          member.value,
        ]),
      });
    }
    case "updateMember": {
      const lines = classAt(operation.className);
      const entry = lines?.members[operation.index];
      if (lines === undefined || entry === undefined) {
        return refuse(
          "unknownMember",
          `${operation.className}[${operation.index}]`,
        );
      }
      const member = checkMember(operation.member);
      if (!member.ok) return member;
      const text = entry.inBlock
        ? member.value
        : `${lines.name} : ${member.value}`;
      return ok({
        edits: [
          replaceLine(entry.line, `${leadingWhitespace(entry.line)}${text}`),
        ],
        expected: withMembers(meaning, lines.name, (existing) =>
          existing.map((value, index) =>
            index === operation.index ? member.value : value,
          ),
        ),
      });
    }
    case "deleteMember": {
      const lines = classAt(operation.className);
      const entry = lines?.members[operation.index];
      if (lines === undefined || entry === undefined) {
        return refuse(
          "unknownMember",
          `${operation.className}[${operation.index}]`,
        );
      }
      return ok({
        edits: [removeLine(entry.line, read.lines)],
        expected: withMembers(meaning, lines.name, (existing) =>
          existing.filter((_, index) => index !== operation.index),
        ),
      });
    }
    case "addRelationship": {
      const relationship = checkRelationship(operation.relationship);
      if (!relationship.ok) return relationship;
      const edit = appendLines([
        `${indent}${classRelationshipText(relationship.value)}`,
      ]);
      return ok({
        edits: [edit],
        expected: withRelationships(current, [
          ...meaning.relationships,
          relationship.value,
        ]),
      });
    }
    case "updateRelationship": {
      const line = current.relationshipLines[operation.index];
      if (line === undefined)
        return refuse("unknownRelationship", String(operation.index));
      const relationship = checkRelationship(operation.relationship);
      if (!relationship.ok) return relationship;
      return ok({
        edits: [
          replaceLine(
            line,
            `${leadingWhitespace(line)}${classRelationshipText(relationship.value)}`,
          ),
        ],
        expected: withRelationships(
          current,
          meaning.relationships.map((existing, index) =>
            index === operation.index ? relationship.value : existing,
          ),
        ),
      });
    }
    case "deleteRelationship": {
      const line = current.relationshipLines[operation.index];
      if (line === undefined)
        return refuse("unknownRelationship", String(operation.index));
      return ok({
        edits: [removeLine(line, read.lines)],
        expected: withRelationships(
          current,
          meaning.relationships.filter((_, index) => index !== operation.index),
        ),
      });
    }
  }
}

function normalized(meaning: ClassMeaning): ClassMeaning {
  return {
    ...meaning,
    classes: [...meaning.classes].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

export function verifyClassCandidate(
  candidateSource: string,
  expected: ClassMeaning,
): DomainResult<void> {
  const candidate = readClass(candidateSource);
  return verifyMeaning(
    { editable: candidate.editable, meaning: normalized(candidate.meaning) },
    normalized(expected),
  );
}

export const CLASS_EDITOR: DiagramEditorEntry = {
  type: "class",
  assess: (source) => assessment(readClass(source).notReadable),
};
