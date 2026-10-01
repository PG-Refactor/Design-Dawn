import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { TreeItem } from "./tree-item";
import { treeNavigation } from "./view-models/keyboard-navigation";
import {
  documentTreeKey,
  flattenProjectTree,
  PROJECT_TREE_KEY,
  sheetTreeKey,
} from "./view-models/tree-items";
import {
  type DocumentNode,
  type ProjectTreeModel,
  type SheetNode,
  selectProjectTree,
} from "./view-models/tree-model";
import type { WorkspaceActions } from "./workspace-actions";
import { useWorkspaceModel } from "./workspace-hooks";
import { MESSAGES } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./project-tree.css";

// The key of the item that is currently selected, where the tab stop starts.
function activeKeyOf(model: ProjectTreeModel): string {
  for (const documentNode of model.documents) {
    if (!documentNode.isActive) continue;
    const activeSheet = documentNode.sheets.find((sheet) => sheet.isActive);
    return activeSheet === undefined
      ? documentTreeKey(documentNode.documentId)
      : sheetTreeKey(documentNode.documentId, activeSheet.sheetId);
  }
  return PROJECT_TREE_KEY;
}

interface TreeHandlers {
  readonly actions: WorkspaceActions;
  readonly rovingKey: string;
  readonly register: (key: string, element: HTMLLIElement | null) => void;
  readonly onFocusItem: (key: string) => void;
  readonly onNavigate: (
    event: KeyboardEvent<HTMLLIElement>,
    key: string,
  ) => void;
}

function SheetTreeItem({
  documentNode,
  sheetNode,
  handlers,
}: {
  readonly documentNode: DocumentNode;
  readonly sheetNode: SheetNode;
  readonly handlers: TreeHandlers;
}) {
  const { actions } = handlers;
  const itemKey = sheetTreeKey(documentNode.documentId, sheetNode.sheetId);
  const failed = sheetNode.state === "loadFailed";
  return (
    <TreeItem
      itemKey={itemKey}
      label={sheetNode.name}
      isRoving={handlers.rovingKey === itemKey}
      selected={failed ? false : sheetNode.isActive}
      failed={failed}
      register={handlers.register}
      onFocusItem={handlers.onFocusItem}
      onNavigate={handlers.onNavigate}
      onActivate={
        failed
          ? undefined
          : () =>
              void actions.selectSheet(
                documentNode.documentId,
                sheetNode.sheetId,
              )
      }
      actions={[
        {
          label: MESSAGES.tree.deleteSheet,
          onClick: () =>
            actions.requestDeleteSheet(
              documentNode.documentId,
              sheetNode.sheetId,
            ),
        },
      ]}
    />
  );
}

function DocumentTreeItem({
  documentNode,
  handlers,
}: {
  readonly documentNode: DocumentNode;
  readonly handlers: TreeHandlers;
}) {
  const { actions } = handlers;
  const itemKey = documentTreeKey(documentNode.documentId);
  const failed = documentNode.state === "loadFailed";
  const deleteAction = {
    label: MESSAGES.tree.deleteDocument,
    onClick: () => actions.requestDeleteDocument(documentNode.documentId),
  };
  return (
    <TreeItem
      itemKey={itemKey}
      label={documentNode.name}
      isRoving={handlers.rovingKey === itemKey}
      selected={documentNode.isActive}
      expanded={failed ? undefined : documentNode.isOpen}
      failed={failed}
      register={handlers.register}
      onFocusItem={handlers.onFocusItem}
      onNavigate={handlers.onNavigate}
      onActivate={
        failed
          ? undefined
          : () => void actions.openDocument(documentNode.documentId)
      }
      actions={
        failed
          ? [deleteAction]
          : [
              {
                label: MESSAGES.tree.createSheet,
                onClick: () =>
                  void actions.requestCreateSheet(documentNode.documentId),
              },
              deleteAction,
            ]
      }
    >
      {documentNode.sheets.length > 0 ? (
        // biome-ignore lint/a11y/useSemanticElements: the ARIA tree pattern nests items in a role="group" list.
        <ul role="group" className="project-tree__group">
          {documentNode.sheets.map((sheetNode) => (
            <SheetTreeItem
              key={sheetNode.sheetId}
              documentNode={documentNode}
              sheetNode={sheetNode}
              handlers={handlers}
            />
          ))}
        </ul>
      ) : null}
    </TreeItem>
  );
}

function ProjectTreeView({ model }: { readonly model: ProjectTreeModel }) {
  const { actions } = useWorkspaceServices();
  const items = useMemo(() => flattenProjectTree(model), [model]);
  const itemElements = useRef(new Map<string, HTMLLIElement>());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const rovingKey =
    focusedKey !== null && items.some((item) => item.key === focusedKey)
      ? focusedKey
      : activeKeyOf(model);

  function register(key: string, element: HTMLLIElement | null): void {
    if (element === null) itemElements.current.delete(key);
    else itemElements.current.set(key, element);
  }

  function handleNavigate(
    event: KeyboardEvent<HTMLLIElement>,
    key: string,
  ): void {
    const navigation = treeNavigation(
      event.key,
      items,
      items.findIndex((item) => item.key === key),
    );
    if (navigation === null) return;
    event.preventDefault();
    const target = items[navigation.index];
    if (target === undefined) return;
    if (navigation.action === "focus") {
      itemElements.current.get(target.key)?.focus();
      return;
    }
    const documentNode = model.documents.find(
      (candidate) => documentTreeKey(candidate.documentId) === target.key,
    );
    if (documentNode !== undefined) {
      void actions.openDocument(documentNode.documentId);
    }
  }

  const handlers: TreeHandlers = {
    actions,
    rovingKey,
    register,
    onFocusItem: setFocusedKey,
    onNavigate: handleNavigate,
  };

  return (
    <ul
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA tree pattern puts role="tree" on a list.
      role="tree"
      aria-label={MESSAGES.appRegionTreeLabel}
      className="project-tree"
    >
      <TreeItem
        itemKey={PROJECT_TREE_KEY}
        label={model.projectName}
        isRoving={rovingKey === PROJECT_TREE_KEY}
        expanded
        register={register}
        onFocusItem={setFocusedKey}
        onNavigate={handleNavigate}
        actions={[
          {
            label: MESSAGES.tree.createDocument,
            onClick: actions.requestCreateDocument,
          },
        ]}
      >
        {model.documents.length === 0 ? (
          <p className="project-tree__empty">{MESSAGES.tree.emptyProject}</p>
        ) : (
          // biome-ignore lint/a11y/useSemanticElements: the ARIA tree pattern nests items in a role="group" list.
          <ul role="group" className="project-tree__group">
            {model.documents.map((documentNode) => (
              <DocumentTreeItem
                key={documentNode.documentId}
                documentNode={documentNode}
                handlers={handlers}
              />
            ))}
          </ul>
        )}
      </TreeItem>
    </ul>
  );
}

export function ProjectTree() {
  const model = useWorkspaceModel(selectProjectTree);
  return model === null ? (
    <p className="project-tree__empty">{MESSAGES.tree.noProject}</p>
  ) : (
    <ProjectTreeView model={model} />
  );
}
