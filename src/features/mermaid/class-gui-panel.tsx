import { useMemo, useState } from "react";
import {
  CLASS_ARROWS,
  type ClassArrow,
  type ClassRelationship,
  classRelationshipText,
  readClass,
} from "../../domain/diagram/listed/class-diagram";
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
import { useListedPick } from "./use-listed-pick";
import { useListedRun } from "./use-listed-run";
import "./listed-gui.css";

function arrowOf(value: string): ClassArrow {
  return CLASS_ARROWS.find((arrow) => arrow === value) ?? "-->";
}

function relationshipOf(values: FieldValues): ClassRelationship {
  return {
    from: textValue(values, "from"),
    fromCardinality: textValue(values, "fromCardinality"),
    arrow: arrowOf(textValue(values, "arrow")),
    toCardinality: textValue(values, "toCardinality"),
    to: textValue(values, "to"),
    label: textValue(values, "label"),
  };
}

// The class diagram editor: classes with their members, and relationships.
export function ClassGuiPanel({
  target,
  source,
}: {
  readonly target: DiagramOperationTarget;
  readonly source: string;
}) {
  const messages = LISTED_GUI_MESSAGES[useDisplayLanguage()];
  const texts = messages.class;
  const { meaning } = useMemo(() => readClass(source), [source]);
  const { busy, run, status } = useListedRun(target);
  const [classKey, setClassKey] = useState<string | null>(null);
  const [memberKey, setMemberKey] = useState<string | null>(null);
  const [relationshipKey, setRelationshipKey] = useState<string | null>(null);
  const item = meaning.classes.find((candidate) => candidate.name === classKey);
  const memberIndex = memberKey === null ? -1 : Number(memberKey);
  const member = item?.members[memberIndex];
  const relationshipIndex =
    relationshipKey === null ? -1 : Number(relationshipKey);
  const relationship = meaning.relationships[relationshipIndex];
  useListedPick((hit) => {
    if (
      hit.kind === "class" &&
      meaning.classes.some((candidate) => candidate.name === hit.id)
    ) {
      setClassKey(hit.id);
      setMemberKey(null);
    } else if (
      hit.kind === "relationship" &&
      hit.ordinal !== undefined &&
      meaning.relationships[hit.ordinal] !== undefined
    ) {
      setRelationshipKey(String(hit.ordinal));
    }
  });
  const relationshipFields: readonly ListedField[] = [
    { id: "from", label: texts.from, kind: "text" },
    { id: "fromCardinality", label: texts.fromCardinality, kind: "text" },
    {
      id: "arrow",
      label: texts.arrow,
      kind: "select",
      options: CLASS_ARROWS.map((arrow) => ({
        value: arrow,
        label: texts.arrows[arrow],
      })),
    },
    { id: "toCardinality", label: texts.toCardinality, kind: "text" },
    { id: "to", label: texts.to, kind: "text" },
    { id: "label", label: texts.label, kind: "text" },
  ];

  return (
    <div className="listed-gui">
      {status}
      <section className="listed-gui__section">
        <h4 className="diagram-gui__heading">{texts.classes}</h4>
        <ListedList
          label={texts.classes}
          items={meaning.classes.map((entry) => ({
            key: entry.name,
            label: entry.name,
            detail: texts.memberCount(entry.members.length),
          }))}
          selectedKey={classKey}
          emptyText={texts.classesEmpty}
          onSelect={(key) => {
            setClassKey(key);
            setMemberKey(null);
          }}
        />
        <ListedForm
          title={texts.addClass}
          fields={[{ id: "name", label: texts.className, kind: "text" }]}
          initial={{ name: "" }}
          submitLabel={messages.add}
          busy={busy}
          onSubmit={(values) =>
            run({
              diagram: "class",
              operation: {
                kind: "addClass",
                name: textValue(values, "name").trim(),
              },
            })
          }
        />
        {item !== undefined && (
          <div className="listed-gui__nested">
            <h5 className="listed-gui__form-title">
              {texts.members(item.name)}
            </h5>
            <ListedList
              label={texts.members(item.name)}
              items={item.members.map((text, index) => ({
                key: String(index),
                label: text,
              }))}
              selectedKey={memberKey}
              emptyText={texts.membersEmpty}
              onSelect={setMemberKey}
            />
            {member !== undefined && (
              <ListedForm
                key={`${item.name}:${memberIndex}:${source.length}`}
                title={texts.editMember}
                fields={[{ id: "member", label: texts.member, kind: "text" }]}
                initial={{ member }}
                submitLabel={messages.apply}
                busy={busy}
                onSubmit={(values) =>
                  run({
                    diagram: "class",
                    operation: {
                      kind: "updateMember",
                      className: item.name,
                      index: memberIndex,
                      member: textValue(values, "member"),
                    },
                  })
                }
                deleteLabel={messages.delete}
                onDelete={() => {
                  setMemberKey(null);
                  void run({
                    diagram: "class",
                    operation: {
                      kind: "deleteMember",
                      className: item.name,
                      index: memberIndex,
                    },
                  });
                }}
              />
            )}
            <ListedForm
              key={`add-member:${item.name}`}
              title={texts.addMember}
              fields={[{ id: "member", label: texts.member, kind: "text" }]}
              initial={{ member: "" }}
              submitLabel={messages.add}
              busy={busy}
              onSubmit={(values) =>
                run({
                  diagram: "class",
                  operation: {
                    kind: "addMember",
                    className: item.name,
                    member: textValue(values, "member"),
                  },
                })
              }
            />
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setClassKey(null);
                void run({
                  diagram: "class",
                  operation: { kind: "deleteClass", name: item.name },
                });
              }}
            >
              {texts.deleteClass}
            </button>
          </div>
        )}
      </section>
      <section className="listed-gui__section">
        <h4 className="diagram-gui__heading">{texts.relationships}</h4>
        <ListedList
          label={texts.relationships}
          items={meaning.relationships.map((entry, index) => ({
            key: String(index),
            label: classRelationshipText(entry),
          }))}
          selectedKey={relationshipKey}
          emptyText={texts.relationshipsEmpty}
          onSelect={setRelationshipKey}
        />
        {relationship !== undefined && (
          <ListedForm
            key={`${relationshipIndex}:${source.length}`}
            title={texts.editRelationship}
            fields={relationshipFields}
            initial={{ ...relationship }}
            submitLabel={messages.apply}
            busy={busy}
            onSubmit={(values) =>
              run({
                diagram: "class",
                operation: {
                  kind: "updateRelationship",
                  index: relationshipIndex,
                  relationship: relationshipOf(values),
                },
              })
            }
            deleteLabel={messages.delete}
            onDelete={() => {
              setRelationshipKey(null);
              void run({
                diagram: "class",
                operation: {
                  kind: "deleteRelationship",
                  index: relationshipIndex,
                },
              });
            }}
          />
        )}
        <ListedForm
          title={texts.addRelationship}
          fields={relationshipFields}
          initial={{
            from: "",
            fromCardinality: "",
            arrow: "-->",
            toCardinality: "",
            to: "",
            label: "",
          }}
          submitLabel={messages.add}
          busy={busy}
          onSubmit={(values) =>
            run({
              diagram: "class",
              operation: {
                kind: "addRelationship",
                relationship: relationshipOf(values),
              },
            })
          }
        />
      </section>
    </div>
  );
}
