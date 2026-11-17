import { useMemo, useRef, useState } from "react";
import {
  ER_KEYS,
  ER_LEFT_CARDINALITIES,
  ER_RIGHT_CARDINALITIES,
  type ErAttribute,
  type ErKey,
  type ErLeftCardinality,
  type ErRelationship,
  type ErRightCardinality,
  readEr,
} from "../../domain/diagram/listed/er-diagram";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import { useDisplayLanguage, useMessages } from "../workspace/use-messages";
import { DiagramAddDialogs, useGuiLayoutState } from "./diagram-gui-layout";
import type { DiagramHit } from "./diagram-shapes";
import {
  checkedValue,
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

const NO_KEY = "";

function attributeOf(values: FieldValues): ErAttribute {
  const key = textValue(values, "key");
  return {
    type: textValue(values, "type"),
    name: textValue(values, "name"),
    keys: (ER_KEYS as readonly string[]).includes(key) ? [key as ErKey] : [],
    comment: textValue(values, "comment"),
  };
}

function relationshipOf(values: FieldValues): ErRelationship {
  return {
    left: textValue(values, "left"),
    leftCardinality: textValue(values, "leftCardinality") as ErLeftCardinality,
    identifying: checkedValue(values, "identifying"),
    rightCardinality: textValue(
      values,
      "rightCardinality",
    ) as ErRightCardinality,
    right: textValue(values, "right"),
    label: textValue(values, "label"),
  };
}

const ADD_ENTITY = "entity";
const ADD_RELATIONSHIP = "relationship";

// The ER diagram editor: entities with their attributes, and relationships.
export function ErGuiPanel({
  target,
  source,
}: {
  readonly target: DiagramOperationTarget;
  readonly source: string;
}) {
  const messages = LISTED_GUI_MESSAGES[useDisplayLanguage()];
  const gui = useMessages().mermaid.gui;
  const er = messages.er;
  const { meaning } = useMemo(() => readEr(source), [source]);
  const { busy, run, status } = useListedRun(target);
  const [entityKey, setEntityKey] = useState<string | null>(null);
  const [attributeKey, setAttributeKey] = useState<string | null>(null);
  const [relationshipKey, setRelationshipKey] = useState<string | null>(null);
  const entity = meaning.entities.find(
    (candidate) => candidate.name === entityKey,
  );
  const attributeIndex = attributeKey === null ? -1 : Number(attributeKey);
  const attribute = entity?.attributes[attributeIndex];
  const relationshipIndex =
    relationshipKey === null ? -1 : Number(relationshipKey);
  const relationship = meaning.relationships[relationshipIndex];
  const rootRef = useRef<HTMLDivElement>(null);
  const layout = useGuiLayoutState("");
  const entityOf = (hit: DiagramHit | null) =>
    hit?.kind === "entity"
      ? meaning.entities.find((item) => item.name === hit.id)
      : undefined;
  const relationshipIndexOf = (hit: DiagramHit | null) =>
    hit?.kind === "relationship" &&
    hit.ordinal !== undefined &&
    meaning.relationships[hit.ordinal] !== undefined
      ? hit.ordinal
      : null;
  const selectEntity = (name: string) => {
    setEntityKey(name);
    setAttributeKey(null);
  };
  useListedPick(
    (hit) => {
      const picked = entityOf(hit);
      const index = relationshipIndexOf(hit);
      if (picked !== undefined) selectEntity(picked.name);
      else if (index !== null) setRelationshipKey(String(index));
    },
    (hit) => {
      const picked = entityOf(hit);
      const index = relationshipIndexOf(hit);
      const own: PopupMenuEntry[] = [];
      if (picked !== undefined) {
        own.push(
          {
            id: "editEntity",
            label: er.editEntityMenu,
            onSelect: () => {
              selectEntity(picked.name);
              focusFormLater(rootRef, er.addAttribute);
            },
          },
          {
            id: "deleteEntity",
            label: er.deleteEntity,
            onSelect: () => {
              setEntityKey(null);
              void run({
                diagram: "er",
                operation: { kind: "deleteEntity", name: picked.name },
              });
            },
          },
        );
      }
      if (index !== null) {
        own.push(
          {
            id: "editRelationship",
            label: er.editRelationshipMenu,
            onSelect: () => {
              setRelationshipKey(String(index));
              focusFormLater(rootRef, er.editRelationship);
            },
          },
          {
            id: "deleteRelationship",
            label: er.deleteRelationshipMenu,
            onSelect: () => {
              setRelationshipKey(null);
              void run({
                diagram: "er",
                operation: { kind: "deleteRelationship", index },
              });
            },
          },
        );
      }
      return withAdditions(own, [
        {
          id: "addEntity",
          label: er.addEntity,
          onSelect: () => layout.openAdd(ADD_ENTITY, true),
        },
        {
          id: "addRelationship",
          label: er.addRelationship,
          onSelect: () => layout.openAdd(ADD_RELATIONSHIP, true),
        },
      ]);
    },
  );

  const attributeFields: readonly ListedField[] = [
    { id: "type", label: er.attributeType, kind: "text" },
    { id: "name", label: er.attributeName, kind: "text" },
    {
      id: "key",
      label: er.attributeKey,
      kind: "select",
      options: [
        { value: NO_KEY, label: messages.none },
        ...ER_KEYS.map((key) => ({ value: key, label: key })),
      ],
    },
    { id: "comment", label: er.attributeComment, kind: "text" },
  ];
  const relationshipFields: readonly ListedField[] = [
    { id: "left", label: er.left, kind: "text" },
    {
      id: "leftCardinality",
      label: er.leftCardinality,
      kind: "select",
      options: ER_LEFT_CARDINALITIES.map((value) => ({ value, label: value })),
    },
    { id: "identifying", label: er.identifying, kind: "checkbox" },
    {
      id: "rightCardinality",
      label: er.rightCardinality,
      kind: "select",
      options: ER_RIGHT_CARDINALITIES.map((value) => ({ value, label: value })),
    },
    { id: "right", label: er.right, kind: "text" },
    { id: "label", label: er.label, kind: "text" },
  ];
  const emptyRelationship: FieldValues = {
    left: "",
    leftCardinality: "||",
    identifying: true,
    rightCardinality: "o{",
    right: "",
    label: "",
  };

  return (
    <div ref={rootRef} className="listed-gui">
      <DiagramAddDialogs
        state={layout}
        source={source}
        toolbarLabel={gui.addToolbarLabel}
        addActions={[
          {
            id: ADD_ENTITY,
            label: er.addEntityToggle,
            menuLabel: er.addEntity,
            form: (
              <ListedForm
                title={er.addEntity}
                fields={[{ id: "name", label: er.entityName, kind: "text" }]}
                initial={{ name: "" }}
                submitLabel={messages.add}
                operationOf={(values) =>
                  textValue(values, "name").trim() === ""
                    ? null
                    : {
                        diagram: "er",
                        operation: {
                          kind: "addEntity",
                          name: textValue(values, "name").trim(),
                        },
                      }
                }
                busy={busy}
                onSubmit={(values) =>
                  run({
                    diagram: "er",
                    operation: {
                      kind: "addEntity",
                      name: textValue(values, "name").trim(),
                    },
                  })
                }
              />
            ),
          },
          {
            id: ADD_RELATIONSHIP,
            label: er.addRelationshipToggle,
            menuLabel: er.addRelationship,
            form: (
              <ListedForm
                title={er.addRelationship}
                fields={relationshipFields}
                initial={emptyRelationship}
                submitLabel={messages.add}
                operationOf={(values) =>
                  textValue(values, "left").trim() === "" ||
                  textValue(values, "right").trim() === ""
                    ? null
                    : {
                        diagram: "er",
                        operation: {
                          kind: "addRelationship",
                          relationship: relationshipOf(values),
                        },
                      }
                }
                busy={busy}
                onSubmit={(values) =>
                  run({
                    diagram: "er",
                    operation: {
                      kind: "addRelationship",
                      relationship: relationshipOf(values),
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
        <h4 className="diagram-gui__heading">{er.entities}</h4>
        <ListedList
          label={er.entities}
          items={meaning.entities.map((item) => ({
            key: item.name,
            label: item.name,
            detail: er.attributeCount(item.attributes.length),
          }))}
          selectedKey={entityKey}
          emptyText={er.entitiesEmpty}
          onSelect={(key) => {
            setEntityKey(key);
            setAttributeKey(null);
          }}
        />
        {entity !== undefined && (
          <div className="listed-gui__nested">
            <h5 className="listed-gui__form-title">
              {er.attributes(entity.name)}
            </h5>
            <ListedList
              label={er.attributes(entity.name)}
              items={entity.attributes.map((item, index) => ({
                key: String(index),
                label: `${item.type} ${item.name}`,
                detail: [...item.keys, item.comment]
                  .filter((part) => part !== "")
                  .join(" "),
              }))}
              selectedKey={attributeKey}
              emptyText={er.attributesEmpty}
              onSelect={setAttributeKey}
            />
            {attribute !== undefined && (
              <ListedForm
                key={`${entity.name}:${attributeIndex}:${source.length}`}
                title={er.editAttribute}
                fields={attributeFields}
                initial={{
                  type: attribute.type,
                  name: attribute.name,
                  key: attribute.keys[0] ?? NO_KEY,
                  comment: attribute.comment,
                }}
                submitLabel={messages.apply}
                busy={busy}
                onSubmit={(values) =>
                  run({
                    diagram: "er",
                    operation: {
                      kind: "updateAttribute",
                      entity: entity.name,
                      index: attributeIndex,
                      attribute: attributeOf(values),
                    },
                  })
                }
                deleteLabel={messages.delete}
                onDelete={() => {
                  setAttributeKey(null);
                  void run({
                    diagram: "er",
                    operation: {
                      kind: "deleteAttribute",
                      entity: entity.name,
                      index: attributeIndex,
                    },
                  });
                }}
              />
            )}
            <ListedForm
              key={`add-attribute:${entity.name}`}
              title={er.addAttribute}
              fields={attributeFields}
              initial={{ type: "string", name: "", key: NO_KEY, comment: "" }}
              submitLabel={messages.add}
              busy={busy}
              onSubmit={(values) =>
                run({
                  diagram: "er",
                  operation: {
                    kind: "addAttribute",
                    entity: entity.name,
                    attribute: attributeOf(values),
                  },
                })
              }
            />
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setEntityKey(null);
                void run({
                  diagram: "er",
                  operation: { kind: "deleteEntity", name: entity.name },
                });
              }}
            >
              {er.deleteEntity}
            </button>
          </div>
        )}
      </section>
      <section className="listed-gui__section">
        <h4 className="diagram-gui__heading">{er.relationships}</h4>
        <ListedList
          label={er.relationships}
          items={meaning.relationships.map((item, index) => ({
            key: String(index),
            label: `${item.left} ${item.leftCardinality}${item.identifying ? "--" : ".."}${item.rightCardinality} ${item.right}`,
            detail: item.label,
          }))}
          selectedKey={relationshipKey}
          emptyText={er.relationshipsEmpty}
          onSelect={setRelationshipKey}
        />
        {relationship !== undefined && (
          <ListedForm
            key={`${relationshipIndex}:${source.length}`}
            title={er.editRelationship}
            fields={relationshipFields}
            initial={{ ...relationship }}
            submitLabel={messages.apply}
            busy={busy}
            onSubmit={(values) =>
              run({
                diagram: "er",
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
                diagram: "er",
                operation: {
                  kind: "deleteRelationship",
                  index: relationshipIndex,
                },
              });
            }}
          />
        )}
      </section>
    </div>
  );
}
