// State diagrams (`stateDiagram-v2`, `stateDiagram`) for the GUI: states with a
// description, and transitions (with [*] as start and end).
//
// Understood lines:
//   A --> B                     a transition; `A --> B : label` with a label
//   [*] --> A, A --> [*]        start and end
//   A : description             a state's description (one per state)
//   state "description" as A    the same, declared
//   state A                     a state without a description
//   direction LR                kept as it is (not edited)
// Anything else (composite states, notes, forks, choices, styles ...) makes the diagram
// read-only in the GUI.

import { type DomainResult, ok } from "../../shared/domain-result";
import type { DiagramEditorEntry } from "../diagram-source";
import type { ClassifiedLine, LineRef } from "../source-lines";
import type { TextEdit } from "../text-edit";
import {
  append,
  assessment,
  IDENTIFIER_SOURCE,
  indentOf,
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

// The pseudo state of a start or an end.
export const STATE_TERMINAL = "[*]";

export interface StateItem {
  readonly id: string;
  readonly description: string;
}

export interface StateTransition {
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface StateMeaning {
  readonly states: readonly StateItem[];
  readonly transitions: readonly StateTransition[];
}

export interface StateRead {
  readonly editable: boolean;
  readonly meaning: StateMeaning;
  readonly notReadable: {
    readonly reason: string;
    readonly lines: readonly LineRef[];
  } | null;
  readonly read: ReadLines;
  // The line that declares or describes each state (null when only transitions name it).
  readonly stateLines: ReadonlyMap<string, ClassifiedLine>;
  readonly transitionLines: readonly ClassifiedLine[];
  // States Mermaid does not draw: declared only as `state X` (no description) and in no
  // transition.
  readonly undrawn: ReadonlySet<string>;
}

const HEADERS = ["stateDiagram-v2", "stateDiagram"];
const END_POINT = `(\\[\\*\\]|${IDENTIFIER_SOURCE})`;
const TRANSITION = new RegExp(
  `^\\s*${END_POINT}\\s*-->\\s*${END_POINT}\\s*(?::\\s*(.*?))?\\s*$`,
);
const DESCRIPTION = new RegExp(
  `^\\s*(${IDENTIFIER_SOURCE})\\s*:\\s*(.+?)\\s*$`,
);
const DECLARED = new RegExp(
  `^\\s*state\\s+"([^"]*)"\\s+as\\s+(${IDENTIFIER_SOURCE})\\s*$`,
);
const BARE = new RegExp(`^\\s*state\\s+(${IDENTIFIER_SOURCE})\\s*$`);
// A state on a line of its own: what the GUI writes for a state without a description
// (Mermaid draws it; `state X` alone it does not draw).
const ID_ONLY = new RegExp(`^\\s*(${IDENTIFIER_SOURCE})\\s*$`);
const DIRECTION = /^\s*direction\s+(?:LR|RL|TB|BT)\s*$/;
// Text Mermaid would read as something else: a colon starts a label, braces a block.
const FORBIDDEN_TEXT = /[{}"]/;

export function readState(source: string): StateRead {
  const read = readLines(source);
  const unsupported: LineRef[] = [];
  const order: string[] = [];
  const descriptions = new Map<string, string>();
  const stateLines = new Map<string, ClassifiedLine>();
  const transitions: StateTransition[] = [];
  const transitionLines: ClassifiedLine[] = [];
  const declaredOnly = new Set<string>();
  let reason: string | null = read.structureProblem ? "structureIssue" : null;
  if (!HEADERS.includes(read.header?.text.trim() ?? ""))
    reason ??= "unsupportedLines";

  const note = (id: string) => {
    if (id !== STATE_TERMINAL && !order.includes(id)) order.push(id);
  };
  const describe = (line: ClassifiedLine, id: string, description: string) => {
    // A second description: Mermaid joins them, the GUI shows one.
    if (stateLines.has(id)) {
      unsupported.push(lineRef(line));
      return;
    }
    note(id);
    stateLines.set(id, line);
    descriptions.set(id, description);
  };

  for (const line of read.statements) {
    const transition = TRANSITION.exec(line.text);
    if (transition !== null) {
      const from = transition[1] ?? "";
      const to = transition[2] ?? "";
      note(from);
      note(to);
      transitions.push({ from, to, label: transition[3] ?? "" });
      transitionLines.push(line);
      continue;
    }
    const declared = DECLARED.exec(line.text);
    if (declared !== null) {
      describe(line, declared[2] ?? "", declared[1] ?? "");
      continue;
    }
    const bare = BARE.exec(line.text);
    if (bare !== null) {
      describe(line, bare[1] ?? "", "");
      declaredOnly.add(bare[1] ?? "");
      continue;
    }
    if (DIRECTION.test(line.text)) continue;
    const idOnly = ID_ONLY.exec(line.text);
    if (idOnly !== null) {
      describe(line, idOnly[1] ?? "", "");
      continue;
    }
    const description = DESCRIPTION.exec(line.text);
    if (description !== null) {
      describe(line, description[1] ?? "", description[2] ?? "");
      continue;
    }
    unsupported.push(lineRef(line));
  }
  if (unsupported.length > 0) reason ??= "unsupportedLines";
  const editable = reason === null;
  return {
    editable,
    meaning: {
      states: order.map((id) => ({
        id,
        description: descriptions.get(id) ?? "",
      })),
      transitions,
    },
    notReadable: editable
      ? null
      : { reason: reason ?? "unsupportedLines", lines: unsupported },
    read,
    stateLines,
    transitionLines,
    undrawn: new Set(
      [...declaredOnly].filter(
        (id) =>
          !transitions.some(
            (transition) => transition.from === id || transition.to === id,
          ),
      ),
    ),
  };
}

function stateText(state: StateItem): string {
  return state.description === ""
    ? state.id
    : `${state.id} : ${state.description}`;
}

export function transitionText(transition: StateTransition): string {
  const label = transition.label === "" ? "" : ` : ${transition.label}`;
  return `${transition.from} --> ${transition.to}${label}`;
}

export type StateOperation =
  | { readonly kind: "addState"; readonly state: StateItem }
  | { readonly kind: "updateState"; readonly state: StateItem }
  | { readonly kind: "deleteState"; readonly id: string }
  | { readonly kind: "addTransition"; readonly transition: StateTransition }
  | {
      readonly kind: "updateTransition";
      readonly index: number;
      readonly transition: StateTransition;
    }
  | { readonly kind: "deleteTransition"; readonly index: number };

function checkEndPoint(id: string): DomainResult<string> {
  return id === STATE_TERMINAL ? ok(id) : requireIdentifier(id, "state");
}

function checkTransition(
  transition: StateTransition,
): DomainResult<StateTransition> {
  const from = checkEndPoint(transition.from);
  if (!from.ok) return from;
  const to = checkEndPoint(transition.to);
  if (!to.ok) return to;
  const label = requireText(transition.label, "label", FORBIDDEN_TEXT);
  if (!label.ok) return label;
  return ok({ from: from.value, to: to.value, label: label.value });
}

export interface StatePlan {
  readonly edits: readonly TextEdit[];
  readonly expected: StateMeaning;
}

// States named only by transitions exist exactly while one of them names them.
function withTransitions(
  current: StateRead,
  transitions: readonly StateTransition[],
  states: readonly StateItem[] = current.meaning.states,
): StateMeaning {
  const named = new Set(
    transitions
      .flatMap((transition) => [transition.from, transition.to])
      .filter((id) => id !== STATE_TERMINAL),
  );
  return {
    states: states
      .filter(
        (state) => current.stateLines.has(state.id) || named.has(state.id),
      )
      .concat(
        [...named]
          .filter((id) => !states.some((state) => state.id === id))
          .map((id) => ({ id, description: "" })),
      ),
    transitions,
  };
}

export function planStateOperation(
  source: string,
  operation: StateOperation,
): DomainResult<StatePlan> {
  const current = readState(source);
  if (!current.editable) return refuse("notEditable", "the diagram");
  const { meaning, read } = current;
  const indent = indentOf(read);
  const known = (id: string) => meaning.states.some((state) => state.id === id);
  const appendLines = (texts: readonly string[]): DomainResult<TextEdit> => {
    const edit = append(read, texts);
    return edit === null
      ? refuse("emptySource", "nothing to add to")
      : ok(edit);
  };
  switch (operation.kind) {
    case "addState": {
      const id = requireIdentifier(operation.state.id, "state");
      if (!id.ok) return id;
      if (known(id.value)) return refuse("duplicateName", id.value);
      const description = requireText(
        operation.state.description,
        "description",
        FORBIDDEN_TEXT,
      );
      if (!description.ok) return description;
      const state = { id: id.value, description: description.value };
      const edit = appendLines([`${indent}${stateText(state)}`]);
      if (!edit.ok) return edit;
      return ok({
        edits: [edit.value],
        expected: { ...meaning, states: [...meaning.states, state] },
      });
    }
    case "updateState": {
      if (!known(operation.state.id))
        return refuse("unknownState", operation.state.id);
      const description = requireText(
        operation.state.description,
        "description",
        FORBIDDEN_TEXT,
      );
      if (!description.ok) return description;
      const state = { id: operation.state.id, description: description.value };
      const line = current.stateLines.get(state.id);
      let edit: TextEdit;
      if (line !== undefined) {
        edit = replaceLine(
          line,
          `${leadingWhitespace(line)}${stateText(state)}`,
        );
      } else {
        const appended = appendLines([`${indent}${stateText(state)}`]);
        if (!appended.ok) return appended;
        edit = appended.value;
      }
      return ok({
        edits: [edit],
        expected: {
          ...meaning,
          states: meaning.states.map((existing) =>
            existing.id === state.id ? state : existing,
          ),
        },
      });
    }
    case "deleteState": {
      if (!known(operation.id)) return refuse("unknownState", operation.id);
      if (
        meaning.transitions.some(
          (transition) =>
            transition.from === operation.id || transition.to === operation.id,
        )
      ) {
        return refuse("stateInUse", operation.id);
      }
      const line = current.stateLines.get(operation.id);
      if (line === undefined) return refuse("unknownState", operation.id);
      return ok({
        edits: [removeLine(line, read.lines)],
        expected: {
          ...meaning,
          states: meaning.states.filter((state) => state.id !== operation.id),
        },
      });
    }
    case "addTransition": {
      const transition = checkTransition(operation.transition);
      if (!transition.ok) return transition;
      const edit = appendLines([
        `${indent}${transitionText(transition.value)}`,
      ]);
      if (!edit.ok) return edit;
      return ok({
        edits: [edit.value],
        expected: withTransitions(current, [
          ...meaning.transitions,
          transition.value,
        ]),
      });
    }
    case "updateTransition": {
      const line = current.transitionLines[operation.index];
      if (line === undefined)
        return refuse("unknownTransition", String(operation.index));
      const transition = checkTransition(operation.transition);
      if (!transition.ok) return transition;
      return ok({
        edits: [
          replaceLine(
            line,
            `${leadingWhitespace(line)}${transitionText(transition.value)}`,
          ),
        ],
        expected: withTransitions(
          current,
          meaning.transitions.map((existing, index) =>
            index === operation.index ? transition.value : existing,
          ),
        ),
      });
    }
    case "deleteTransition": {
      const line = current.transitionLines[operation.index];
      if (line === undefined)
        return refuse("unknownTransition", String(operation.index));
      return ok({
        edits: [removeLine(line, read.lines)],
        expected: withTransitions(
          current,
          meaning.transitions.filter((_, index) => index !== operation.index),
        ),
      });
    }
  }
}

function normalized(meaning: StateMeaning): StateMeaning {
  return {
    ...meaning,
    states: [...meaning.states].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}

export function verifyStateCandidate(
  candidateSource: string,
  expected: StateMeaning,
): DomainResult<void> {
  const candidate = readState(candidateSource);
  return verifyMeaning(
    { editable: candidate.editable, meaning: normalized(candidate.meaning) },
    normalized(expected),
  );
}

export const STATE_EDITOR: DiagramEditorEntry = {
  type: "state",
  assess: (source) => assessment(readState(source).notReadable),
};
