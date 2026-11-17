import { useMemo, useRef, useState } from "react";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import {
  readState,
  STATE_TERMINAL,
  type StateTransition,
} from "../../domain/diagram/listed/state-diagram";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import { useDisplayLanguage, useMessages } from "../workspace/use-messages";
import { DiagramAddDialogs, useGuiLayoutState } from "./diagram-gui-layout";
import type { DiagramHit } from "./diagram-shapes";
import {
  type FieldValues,
  type ListedField,
  ListedForm,
  ListedList,
  textValue,
} from "./listed-gui";
import { LISTED_GUI_MESSAGES } from "./listed-gui-messages";
import type { DiagramOperationTarget } from "./use-diagram-operation";
import {
  focusFormLater,
  useListedPick,
  withAdditions,
} from "./use-listed-pick";
import { useListedRun } from "./use-listed-run";
import "./listed-gui.css";

function transitionOf(values: FieldValues): StateTransition {
  return {
    from: textValue(values, "from"),
    to: textValue(values, "to"),
    label: textValue(values, "label"),
  };
}

const ADD_STATE = "state";
const ADD_TRANSITION = "transition";

// The operation of the add-state form. An empty ID is still sent when the user adds (the
// refusal tells why); the preview waits for one.
function addStateOperation(values: FieldValues): DiagramOperation {
  return {
    diagram: "state",
    operation: {
      kind: "addState",
      state: {
        id: textValue(values, "id").trim(),
        description: textValue(values, "description"),
      },
    },
  };
}

// The state diagram editor: states with a description, and transitions.
export function StateGuiPanel({
  target,
  source,
}: {
  readonly target: DiagramOperationTarget;
  readonly source: string;
}) {
  const messages = LISTED_GUI_MESSAGES[useDisplayLanguage()];
  const gui = useMessages().mermaid.gui;
  const texts = messages.state;
  const { meaning } = useMemo(() => readState(source), [source]);
  const { busy, run, status } = useListedRun(target);
  const [stateKey, setStateKey] = useState<string | null>(null);
  const [transitionKey, setTransitionKey] = useState<string | null>(null);
  const state = meaning.states.find((candidate) => candidate.id === stateKey);
  const transitionIndex = transitionKey === null ? -1 : Number(transitionKey);
  const transition = meaning.transitions[transitionIndex];
  const rootRef = useRef<HTMLDivElement>(null);
  const layout = useGuiLayoutState("");
  const stateOf = (hit: DiagramHit | null) =>
    hit?.kind === "state"
      ? meaning.states.find((item) => item.id === hit.id)
      : undefined;
  const transitionIndexOf = (hit: DiagramHit | null) =>
    hit?.kind === "transition" &&
    hit.ordinal !== undefined &&
    meaning.transitions[hit.ordinal] !== undefined
      ? hit.ordinal
      : null;
  useListedPick(
    (hit) => {
      const picked = stateOf(hit);
      const index = transitionIndexOf(hit);
      if (picked !== undefined) setStateKey(picked.id);
      else if (index !== null) setTransitionKey(String(index));
    },
    (hit) => {
      const picked = stateOf(hit);
      const index = transitionIndexOf(hit);
      const own: PopupMenuEntry[] = [];
      if (picked !== undefined) {
        own.push(
          {
            id: "editState",
            label: texts.editStateMenu,
            onSelect: () => {
              setStateKey(picked.id);
              focusFormLater(rootRef, texts.editState);
            },
          },
          {
            id: "deleteState",
            label: texts.deleteStateMenu,
            onSelect: () => {
              setStateKey(null);
              void run({
                diagram: "state",
                operation: { kind: "deleteState", id: picked.id },
              });
            },
          },
        );
      }
      if (index !== null) {
        own.push(
          {
            id: "editTransition",
            label: texts.editTransitionMenu,
            onSelect: () => {
              setTransitionKey(String(index));
              focusFormLater(rootRef, texts.editTransition);
            },
          },
          {
            id: "deleteTransition",
            label: texts.deleteTransitionMenu,
            onSelect: () => {
              setTransitionKey(null);
              void run({
                diagram: "state",
                operation: { kind: "deleteTransition", index },
              });
            },
          },
        );
      }
      return withAdditions(own, [
        {
          id: "addState",
          label: texts.addState,
          onSelect: () => layout.openAdd(ADD_STATE, true),
        },
        {
          id: "addTransition",
          label: texts.addTransition,
          onSelect: () => layout.openAdd(ADD_TRANSITION, true),
        },
      ]);
    },
  );
  // Where a transition may start or end: every state, and the start / end point.
  const endPoints = [
    { value: STATE_TERMINAL, label: texts.terminal },
    ...meaning.states.map((item) => ({ value: item.id, label: item.id })),
  ];
  const transitionFields: readonly ListedField[] = [
    { id: "from", label: texts.from, kind: "select", options: endPoints },
    { id: "to", label: texts.to, kind: "select", options: endPoints },
    { id: "label", label: texts.label, kind: "text" },
  ];

  return (
    <div ref={rootRef} className="listed-gui">
      <DiagramAddDialogs
        state={layout}
        source={source}
        toolbarLabel={gui.addToolbarLabel}
        addActions={[
          {
            id: ADD_STATE,
            label: texts.addStateToggle,
            menuLabel: texts.addState,
            form: (
              <ListedForm
                title={texts.addState}
                fields={[
                  { id: "id", label: texts.stateId, kind: "text" },
                  { id: "description", label: texts.description, kind: "text" },
                ]}
                initial={{ id: "", description: "" }}
                submitLabel={messages.add}
                operationOf={(values) =>
                  textValue(values, "id").trim() === ""
                    ? null
                    : addStateOperation(values)
                }
                busy={busy}
                onSubmit={(values) => run(addStateOperation(values))}
              />
            ),
          },
          {
            id: ADD_TRANSITION,
            label: texts.addTransitionToggle,
            menuLabel: texts.addTransition,
            form: (
              <ListedForm
                key={`add-transition:${meaning.states.length}`}
                title={texts.addTransition}
                fields={transitionFields}
                initial={{
                  from: STATE_TERMINAL,
                  to: meaning.states[0]?.id ?? STATE_TERMINAL,
                  label: "",
                }}
                submitLabel={messages.add}
                operationOf={(values) => ({
                  diagram: "state",
                  operation: {
                    kind: "addTransition",
                    transition: transitionOf(values),
                  },
                })}
                busy={busy}
                onSubmit={(values) =>
                  run({
                    diagram: "state",
                    operation: {
                      kind: "addTransition",
                      transition: transitionOf(values),
                    },
                  })
                }
              />
            ),
          },
        ]}
      />
      {status}
      <section className="listed-gui__section">
        <h4 className="diagram-gui__heading">{texts.states}</h4>
        <ListedList
          label={texts.states}
          items={meaning.states.map((item) => ({
            key: item.id,
            label: item.id,
            detail: item.description,
          }))}
          selectedKey={stateKey}
          emptyText={texts.statesEmpty}
          onSelect={setStateKey}
        />
        {state !== undefined && (
          <ListedForm
            key={`${state.id}:${source.length}`}
            title={texts.editState}
            fields={[
              { id: "description", label: texts.description, kind: "text" },
            ]}
            initial={{ description: state.description }}
            submitLabel={messages.apply}
            busy={busy}
            onSubmit={(values) =>
              run({
                diagram: "state",
                operation: {
                  kind: "updateState",
                  state: {
                    id: state.id,
                    description: textValue(values, "description"),
                  },
                },
              })
            }
            deleteLabel={messages.delete}
            onDelete={() => {
              setStateKey(null);
              void run({
                diagram: "state",
                operation: { kind: "deleteState", id: state.id },
              });
            }}
          />
        )}
      </section>
      <section className="listed-gui__section">
        <h4 className="diagram-gui__heading">{texts.transitions}</h4>
        <ListedList
          label={texts.transitions}
          items={meaning.transitions.map((item, index) => ({
            key: String(index),
            label: `${item.from} → ${item.to}`,
            detail: item.label,
          }))}
          selectedKey={transitionKey}
          emptyText={texts.transitionsEmpty}
          onSelect={setTransitionKey}
        />
        {transition !== undefined && (
          <ListedForm
            key={`${transitionIndex}:${source.length}`}
            title={texts.editTransition}
            fields={transitionFields}
            initial={{ ...transition }}
            submitLabel={messages.apply}
            busy={busy}
            onSubmit={(values) =>
              run({
                diagram: "state",
                operation: {
                  kind: "updateTransition",
                  index: transitionIndex,
                  transition: transitionOf(values),
                },
              })
            }
            deleteLabel={messages.delete}
            onDelete={() => {
              setTransitionKey(null);
              void run({
                diagram: "state",
                operation: { kind: "deleteTransition", index: transitionIndex },
              });
            }}
          />
        )}
      </section>
    </div>
  );
}
