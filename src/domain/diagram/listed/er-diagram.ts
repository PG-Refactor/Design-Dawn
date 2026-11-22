// ER diagrams (`erDiagram`) for the GUI: entities with attributes, and relationships.
//
// Understood lines:
//   ENTITY                                 an entity without attributes
//   ENTITY {  ...  }                       an entity block; inside, one attribute per line:
//     type name [PK|FK|UK[, ...]] ["comment"]
//   A ||--o{ B : label                     a relationship ("label" or one word)
// Anything else (aliases, a second block for the same entity, direction ...) makes the
// diagram read-only in the GUI.

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

export const ER_KEYS = ["PK", "FK", "UK"] as const;
export type ErKey = (typeof ER_KEYS)[number];
// Left side as written before the line, right side after it (Mermaid's crow's feet).
export const ER_LEFT_CARDINALITIES = ["|o", "||", "}o", "}|"] as const;
export const ER_RIGHT_CARDINALITIES = ["o|", "||", "o{", "|{"] as const;
export type ErLeftCardinality = (typeof ER_LEFT_CARDINALITIES)[number];
export type ErRightCardinality = (typeof ER_RIGHT_CARDINALITIES)[number];

export interface ErAttribute {
  readonly type: string;
  readonly name: string;
  readonly keys: readonly ErKey[];
  readonly comment: string;
}

export interface ErEntity {
  readonly name: string;
  readonly attributes: readonly ErAttribute[];
}

export interface ErRelationship {
  readonly left: string;
  readonly leftCardinality: ErLeftCardinality;
  // `--` (identifying) or `..` (non-identifying).
  readonly identifying: boolean;
  readonly rightCardinality: ErRightCardinality;
  readonly right: string;
  readonly label: string;
}

export interface ErMeaning {
  readonly entities: readonly ErEntity[];
  readonly relationships: readonly ErRelationship[];
}

interface EntityLines {
  readonly name: string;
  // The bare line, or the block (opening and closing lines, one line per attribute).
  readonly bare: ClassifiedLine | null;
  readonly block: EntityBlock | null;
}

// An entity's block: the lines that open and close it, and its attribute lines.
interface EntityBlock {
  readonly open: ClassifiedLine;
  readonly close: ClassifiedLine;
  readonly attributes: readonly ClassifiedLine[];
}

export interface ErRead {
  readonly editable: boolean;
  readonly meaning: ErMeaning;
  readonly notReadable: {
    readonly reason: string;
    readonly lines: readonly LineRef[];
  } | null;
  readonly read: ReadLines;
  readonly entityLines: readonly EntityLines[];
  readonly relationshipLines: readonly ClassifiedLine[];
}

const HEADER = "erDiagram";
const NAME = `(${IDENTIFIER_SOURCE})`;
const BARE_ENTITY = new RegExp(`^\\s*${NAME}\\s*$`);
const BLOCK_OPEN = new RegExp(`^\\s*${NAME}\\s*\\{\\s*$`);
const BLOCK_CLOSE = /^\s*\}\s*$/;
const ATTRIBUTE =
  /^\s*([A-Za-z_][\w()[\],.-]*)\s+([A-Za-z_*][\w-]*)\s*((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?\s*(?:"([^"]*)")?\s*$/;
const LEFT = ER_LEFT_CARDINALITIES.map((value) =>
  value.replace(/[|{}]/g, "\\$&"),
).join("|");
const RIGHT = ER_RIGHT_CARDINALITIES.map((value) =>
  value.replace(/[|{}]/g, "\\$&"),
).join("|");
const RELATIONSHIP = new RegExp(
  `^\\s*${NAME}\\s+(${LEFT})(--|\\.\\.)(${RIGHT})\\s+${NAME}\\s*:\\s*(?:"([^"]*)"|([^\\s"]+))\\s*$`,
);
const KEY_SEPARATOR = /\s*,\s*/;
// An attribute's type and name are one word each; a comment and a label are quoted, and
// braces would open or close a block.
const FORBIDDEN_IN_WORD = /[\s{}"]/;
const FORBIDDEN_IN_COMMENT = /["{}]/;
const FORBIDDEN_IN_LABEL = /"/;
// One word labels are written bare; anything else in quotes (which cannot hold a quote).
const BARE_LABEL = /^[A-Za-z0-9_-]+$/;

// The keys written after an attribute's name (empty when there are none).
function parseKeys(text: string): ErKey[] {
  if (text === "") return [];
  return text
    .split(KEY_SEPARATOR)
    .filter((key): key is ErKey =>
      (ER_KEYS as readonly string[]).includes(key),
    );
}

export function readEr(source: string): ErRead {
  const read = readLines(source);
  const unsupported: LineRef[] = [];
  const entities = new Map<
    string,
    { lines: EntityLines; attributes: ErAttribute[] }
  >();
  const relationships: ErRelationship[] = [];
  const relationshipLines: ClassifiedLine[] = [];
  let reason: string | null = read.structureProblem ? "structureIssue" : null;
  if (read.header?.text.trim() !== HEADER) reason ??= "unsupportedLines";

  const entityFor = (name: string) => {
    let entry = entities.get(name);
    if (entry === undefined) {
      entry = {
        lines: { name, bare: null, block: null },
        attributes: [],
      };
      entities.set(name, entry);
    }
    return entry;
  };

  let openBlock: {
    name: string;
    open: ClassifiedLine;
    attributes: ClassifiedLine[];
  } | null = null;
  for (const line of read.statements) {
    if (openBlock !== null) {
      if (BLOCK_CLOSE.test(line.text)) {
        const entry = entityFor(openBlock.name);
        entry.lines = {
          ...entry.lines,
          block: {
            open: openBlock.open,
            close: line,
            attributes: openBlock.attributes,
          },
        };
        openBlock = null;
        continue;
      }
      const attribute = ATTRIBUTE.exec(line.text);
      if (attribute === null) {
        unsupported.push(lineRef(line));
        continue;
      }
      entityFor(openBlock.name).attributes.push({
        type: capturedText(attribute, 1),
        name: capturedText(attribute, 2),
        keys: parseKeys(capturedText(attribute, 3)),
        comment: capturedText(attribute, 4),
      });
      openBlock.attributes.push(line);
      continue;
    }
    const open = BLOCK_OPEN.exec(line.text);
    if (open !== null) {
      const name = capturedText(open, 1);
      const existing = entities.get(name)?.lines;
      // A second declaration of the same entity: Mermaid merges them, the GUI does not.
      if (
        existing !== undefined &&
        (existing.block !== null || existing.bare !== null)
      ) {
        unsupported.push(lineRef(line));
      }
      openBlock = { name, open: line, attributes: [] };
      entityFor(name);
      continue;
    }
    const relationship = RELATIONSHIP.exec(line.text);
    if (relationship !== null) {
      const left = capturedText(relationship, 1);
      const right = capturedText(relationship, 5);
      entityFor(left);
      entityFor(right);
      relationships.push({
        left,
        leftCardinality: relationship[2] as ErLeftCardinality,
        identifying: relationship[3] === "--",
        rightCardinality: relationship[4] as ErRightCardinality,
        right,
        label: relationship[6] ?? capturedText(relationship, 7),
      });
      relationshipLines.push(line);
      continue;
    }
    const bare = BARE_ENTITY.exec(line.text);
    if (bare !== null) {
      const name = capturedText(bare, 1);
      const existing = entities.get(name)?.lines;
      if (
        existing !== undefined &&
        (existing.block !== null || existing.bare !== null)
      ) {
        unsupported.push(lineRef(line));
      }
      const entry = entityFor(name);
      entry.lines = { ...entry.lines, bare: line };
      continue;
    }
    unsupported.push(lineRef(line));
  }
  if (openBlock !== null) unsupported.push(lineRef(openBlock.open));
  if (unsupported.length > 0) reason ??= "unsupportedLines";
  const editable = reason === null;
  return {
    editable,
    meaning: {
      // In the order the entities are first named (the order of the map).
      entities: [...entities.entries()].map(([name, entry]) => ({
        name,
        attributes: entry.attributes,
      })),
      relationships,
    },
    notReadable: reason === null ? null : { reason, lines: unsupported },
    read,
    entityLines: [...entities.values()].map((entry) => entry.lines),
    relationshipLines,
  };
}

export function attributeText(attribute: ErAttribute): string {
  const keys = attribute.keys.length > 0 ? ` ${attribute.keys.join(", ")}` : "";
  const comment = attribute.comment === "" ? "" : ` "${attribute.comment}"`;
  return `${attribute.type} ${attribute.name}${keys}${comment}`;
}

export function relationshipText(relationship: ErRelationship): string {
  const line = relationship.identifying ? "--" : "..";
  const label = BARE_LABEL.test(relationship.label)
    ? relationship.label
    : `"${relationship.label}"`;
  return `${relationship.left} ${relationship.leftCardinality}${line}${relationship.rightCardinality} ${relationship.right} : ${label}`;
}

export type ErOperation =
  | { readonly kind: "addEntity"; readonly name: string }
  | { readonly kind: "deleteEntity"; readonly name: string }
  | {
      readonly kind: "addAttribute";
      readonly entity: string;
      readonly attribute: ErAttribute;
    }
  | {
      readonly kind: "updateAttribute";
      readonly entity: string;
      readonly index: number;
      readonly attribute: ErAttribute;
    }
  | {
      readonly kind: "deleteAttribute";
      readonly entity: string;
      readonly index: number;
    }
  | { readonly kind: "addRelationship"; readonly relationship: ErRelationship }
  | {
      readonly kind: "updateRelationship";
      readonly index: number;
      readonly relationship: ErRelationship;
    }
  | { readonly kind: "deleteRelationship"; readonly index: number };

function checkAttribute(attribute: ErAttribute): DomainResult<ErAttribute> {
  const type = requireText(attribute.type, "attribute type", FORBIDDEN_IN_WORD);
  if (!type.ok) return type;
  const name = requireText(attribute.name, "attribute name", FORBIDDEN_IN_WORD);
  if (!name.ok) return name;
  const comment = requireText(
    attribute.comment,
    "comment",
    FORBIDDEN_IN_COMMENT,
  );
  if (!comment.ok) return comment;
  if (type.value === "" || name.value === "")
    return refuse("emptyText", "attribute");
  return ok({
    ...attribute,
    type: type.value,
    name: name.value,
    comment: comment.value,
  });
}

function checkRelationship(
  relationship: ErRelationship,
): DomainResult<ErRelationship> {
  const left = requireIdentifier(relationship.left, "entity");
  if (!left.ok) return left;
  const right = requireIdentifier(relationship.right, "entity");
  if (!right.ok) return right;
  const label = requireText(relationship.label, "label", FORBIDDEN_IN_LABEL);
  if (!label.ok) return label;
  if (label.value === "") return refuse("emptyText", "label");
  return ok({ ...relationship, label: label.value });
}

export interface ErPlan {
  readonly edits: readonly TextEdit[];
  readonly expected: ErMeaning;
}

export function planErOperation(
  source: string,
  operation: ErOperation,
): DomainResult<ErPlan> {
  const current = readEr(source);
  if (!current.editable) return refuse("notEditable", "the diagram");
  const { meaning, read } = current;
  const indent = indentOf(read);
  const inner = `${indent}${indent}`;
  const entityAt = (name: string) =>
    current.entityLines.find((lines) => lines.name === name);
  const appendLines = (texts: readonly string[]): TextEdit =>
    append(read, texts);

  switch (operation.kind) {
    case "addEntity": {
      const name = requireIdentifier(operation.name, "entity");
      if (!name.ok) return name;
      if (entityAt(name.value) !== undefined)
        return refuse("duplicateName", name.value);
      const edit = appendLines([`${indent}${name.value}`]);
      return ok({
        edits: [edit],
        expected: {
          ...meaning,
          entities: [...meaning.entities, { name: name.value, attributes: [] }],
        },
      });
    }
    case "deleteEntity": {
      const lines = entityAt(operation.name);
      if (lines === undefined) return refuse("unknownEntity", operation.name);
      if (
        meaning.relationships.some(
          (relationship) =>
            relationship.left === operation.name ||
            relationship.right === operation.name,
        )
      ) {
        return refuse("entityInUse", operation.name);
      }
      const removed = [
        ...(lines.bare === null ? [] : [lines.bare]),
        ...(lines.block === null
          ? []
          : [lines.block.open, ...lines.block.attributes, lines.block.close]),
      ];
      return ok({
        edits: removed.map((line) => removeLine(line, read.lines)),
        expected: {
          ...meaning,
          entities: meaning.entities.filter(
            (entity) => entity.name !== operation.name,
          ),
        },
      });
    }
    case "addAttribute": {
      const lines = entityAt(operation.entity);
      if (lines === undefined) return refuse("unknownEntity", operation.entity);
      const attribute = checkAttribute(operation.attribute);
      if (!attribute.ok) return attribute;
      const text = attributeText(attribute.value);
      let edit: TextEdit;
      if (lines.block !== null) {
        const { open, attributes } = lines.block;
        const first = attributes[0];
        const last = attributes[attributes.length - 1] ?? open;
        const attributeIndent =
          first === undefined
            ? `${leadingWhitespace(open)}${indent}`
            : leadingWhitespace(first);
        edit = insertAfter(last, [`${attributeIndent}${text}`]);
      } else if (lines.bare !== null) {
        const own = leadingWhitespace(lines.bare);
        edit = replaceLine(
          lines.bare,
          [`${own}${lines.name} {`, `${own}${indent}${text}`, `${own}}`].join(
            lines.bare.terminator === "" ? "\n" : lines.bare.terminator,
          ),
        );
      } else {
        edit = appendLines([
          `${indent}${lines.name} {`,
          `${inner}${text}`,
          `${indent}}`,
        ]);
      }
      return ok({
        edits: [edit],
        expected: {
          ...meaning,
          entities: meaning.entities.map((entity) =>
            entity.name === operation.entity
              ? {
                  ...entity,
                  attributes: [...entity.attributes, attribute.value],
                }
              : entity,
          ),
        },
      });
    }
    case "updateAttribute": {
      const lines = entityAt(operation.entity);
      const line = lines?.block?.attributes[operation.index];
      if (line === undefined) {
        return refuse(
          "unknownAttribute",
          `${operation.entity}[${operation.index}]`,
        );
      }
      const attribute = checkAttribute(operation.attribute);
      if (!attribute.ok) return attribute;
      return ok({
        edits: [
          replaceLine(
            line,
            `${leadingWhitespace(line)}${attributeText(attribute.value)}`,
          ),
        ],
        expected: {
          ...meaning,
          entities: meaning.entities.map((entity) =>
            entity.name === operation.entity
              ? {
                  ...entity,
                  attributes: entity.attributes.map((existing, index) =>
                    index === operation.index ? attribute.value : existing,
                  ),
                }
              : entity,
          ),
        },
      });
    }
    case "deleteAttribute": {
      const lines = entityAt(operation.entity);
      const block = lines?.block;
      const line = block?.attributes[operation.index];
      if (lines === undefined || block == null || line === undefined) {
        return refuse(
          "unknownAttribute",
          `${operation.entity}[${operation.index}]`,
        );
      }
      // The last attribute: the block becomes a bare entity line (an empty block is not
      // something every Mermaid version reads).
      const edits =
        block.attributes.length === 1
          ? [
              {
                start: block.open.start,
                end: block.close.end,
                text: `${leadingWhitespace(block.open)}${lines.name}`,
              },
            ]
          : [removeLine(line, read.lines)];
      return ok({
        edits,
        expected: {
          ...meaning,
          entities: meaning.entities.map((entity) =>
            entity.name === operation.entity
              ? {
                  ...entity,
                  attributes: entity.attributes.filter(
                    (_, index) => index !== operation.index,
                  ),
                }
              : entity,
          ),
        },
      });
    }
    case "addRelationship": {
      const relationship = checkRelationship(operation.relationship);
      if (!relationship.ok) return relationship;
      const edit = appendLines([
        `${indent}${relationshipText(relationship.value)}`,
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
            `${leadingWhitespace(line)}${relationshipText(relationship.value)}`,
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

// The meaning with these relationships: declared entities stay, and an entity named only
// by relationships exists exactly while one of them names it.
function withRelationships(
  current: ErRead,
  relationships: readonly ErRelationship[],
): ErMeaning {
  const declared = current.entityLines
    .filter((lines) => lines.bare !== null || lines.block !== null)
    .map((lines) => lines.name);
  const names = new Set([
    ...declared,
    ...relationships.flatMap((relationship) => [
      relationship.left,
      relationship.right,
    ]),
  ]);
  return {
    entities: [...names].map(
      (name) =>
        current.meaning.entities.find((entity) => entity.name === name) ?? {
          name,
          attributes: [],
        },
    ),
    relationships,
  };
}

// Entities compared as a set (their order follows the text, which an edit may change).
function normalized(meaning: ErMeaning): ErMeaning {
  return {
    ...meaning,
    entities: [...meaning.entities].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

export function verifyErCandidate(
  candidateSource: string,
  expected: ErMeaning,
): DomainResult<void> {
  const candidate = readEr(candidateSource);
  return verifyMeaning(
    { editable: candidate.editable, meaning: normalized(candidate.meaning) },
    normalized(expected),
  );
}

export const ER_EDITOR: DiagramEditorEntry = {
  type: "er",
  assess: (source) => assessment(readEr(source).notReadable),
};
