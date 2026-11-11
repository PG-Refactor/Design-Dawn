import { useMemo, useState } from "react";
import {
  readState,
  STATE_TERMINAL,
  type StateTransition,
} from "../../domain/diagram/listed/state-diagram";
import { useDisplayLanguage } from "../workspace/use-messages";
import {
  type FieldValues,
  type ListedField,
  ListedForm,
  ListedList,
  textValue,
} from "./listed-gui";
import { LISTED_GUI_MESSAGES } from "./listed-gui-messages";
import type { DiagramOperationTarget } from "./use-diagram-operation";
import { useListedRun } from "./use-listed-run";
import "./listed-gui.css";

function transitionOf(values: FieldValues): StateTransition {
  return {
    from: textValue(values, "from"),
    to: textValue(values, "to"),
    label: textValue(values, "label"),
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
  const texts = messages.state;
  const { meaning } = useMemo(() => readState(source), [source]);
  const { busy, run, status } = useListedRun(target);
  const [stateKey, setStateKey] = useState<string | null>(null);
  const [transitionKey, setTransitionKey] = useState<string | null>(null);
  const state = meaning.states.find((candidate) => candidate.id === stateKey);
  const transitionIndex = transitionKey === null ? -1 : Number(transitionKey);
  const transition = meaning.transitions[transitionIndex];
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
    <div className="listed-gui">
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
        <ListedForm
          title={texts.addState}
          fields={[
            { id: "id", label: texts.stateId, kind: "text" },
            { id: "description", label: texts.description, kind: "text" },
          ]}
          initial={{ id: "", description: "" }}
          submitLabel={messages.add}
          busy={busy}
          onSubmit={(values) =>
            run({
              diagram: "state",
              operation: {
                kind: "addState",
                state: {
                  id: textValue(values, "id").trim(),
                  description: textValue(values, "description"),
                },
              },
            })
          }
        />
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
      </section>
    </div>
  );
}
