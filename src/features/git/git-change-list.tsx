import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GitStatus } from "../../application/ports/git-gateway";
import { setGitSectionCollapsed } from "../workspace/ui-state/shell-ui-state";
import { useMessages } from "../workspace/use-messages";
import { treeNavigation } from "../workspace/view-models/keyboard-navigation";
import { useGitState, useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import {
  deriveGitChangeSections,
  focusKeyAfterChange,
  type GitChangeEntry,
  type GitChangeSection,
  type GitChangeSectionId,
} from "./git-change-sections";
import {
  buildGitTreeItems,
  sectionKeyOf,
  toFlatTreeItems,
} from "./git-change-tree";
import {
  GitFileRow,
  GitSectionHeader,
  type IndexOperation,
  SECTION_OPERATIONS,
} from "./git-change-tree-items";
import { openDiff, refreshDiffAfterStatusChange } from "./git-diff-session";
import {
  GIT_CHANGE_HEADING_ATTRIBUTE,
  GIT_CHANGE_LIST_ATTRIBUTE,
} from "./git-dom";

interface FocusRequest {
  readonly before: readonly GitChangeSection[];
  readonly actedKey: string;
}

// The change list of a ready repository as one tree (section headers and their files),
// row selection and Stage / Unstage. It only derives from the Git status; the status is
// replaced by the answer of the Git controller, never edited here.
export function GitChangeList({ status }: { readonly status: GitStatus }) {
  const messages = useMessages().git;
  const services = useWorkspaceServices();
  const { gitController, uiStateStore } = services;
  const operating = useGitState((git) => git.operating);
  const refreshing = useGitState((git) => git.refreshing);
  const gitSelection = useUiState((ui) => ui.gitSelection);
  const collapsedSections = useUiState((ui) => ui.gitCollapsedSections);
  const sections = useMemo(() => deriveGitChangeSections(status), [status]);
  const items = useMemo(
    () => buildGitTreeItems(sections, collapsedSections),
    [sections, collapsedSections],
  );
  const flatItems = useMemo(() => toFlatTreeItems(items), [items]);
  const busy = operating || refreshing;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement | null>(null);
  const itemElements = useRef(new Map<string, HTMLDivElement>());
  const [rovingKey, setRovingKey] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const effectiveRovingKey = items.some((item) => item.key === rovingKey)
    ? rovingKey
    : (items[0]?.key ?? null);

  // Runs after the render that shows the controller's answer (the request is set only once
  // the operation has settled), so `sections` is already the new list.
  useEffect(() => {
    if (focusRequest === null) return;
    const key = focusKeyAfterChange(
      focusRequest.before,
      sections,
      focusRequest.actedKey,
    );
    setFocusRequest(null);
    if (key === null) {
      heading.current?.focus();
      return;
    }
    // A row hidden by a collapsed section is reached through its header.
    const targetKey = itemElements.current.has(key)
      ? key
      : sectionKeyOf(sectionIdOfKey(sections, key));
    setRovingKey(targetKey);
    itemElements.current.get(targetKey)?.focus();
  }, [focusRequest, sections]);

  function register(key: string, element: HTMLDivElement | null): void {
    if (element === null) itemElements.current.delete(key);
    else itemElements.current.set(key, element);
  }

  function setCollapsed(sectionId: GitChangeSectionId, collapsed: boolean) {
    uiStateStore.setState((state) =>
      setGitSectionCollapsed(state, sectionId, collapsed),
    );
  }

  function toggleSection(sectionId: GitChangeSectionId): void {
    setCollapsed(sectionId, !collapsedSections.has(sectionId));
  }

  // The single place a selected row is handed on: it selects the row and opens its diff
  // (staged rows the staged one, the others the unstaged one; conflicts open none).
  function selectRow(entry: GitChangeEntry): void {
    if (entry.selectionSide === null) return;
    openDiff(services, { path: entry.path, side: entry.selectionSide });
  }

  async function operate(
    operation: IndexOperation,
    paths: readonly string[],
    actedKey: string,
  ): Promise<void> {
    const before = sections;
    await (operation === "stage"
      ? gitController.stage(paths)
      : gitController.unstage(paths));
    // Success or failure, the controller now holds the status git returned (or re-read).
    refreshDiffAfterStatusChange(services);
    setFocusRequest({ before, actedKey });
  }

  function operateOnRow(entry: GitChangeEntry): void {
    const operation = SECTION_OPERATIONS[entry.sectionId]?.operation;
    if (operation === undefined) return;
    void operate(operation, [entry.path], entry.key);
  }

  function operateOnSection(section: GitChangeSection): void {
    const operation = SECTION_OPERATIONS[section.id]?.operation;
    const first = section.entries[0];
    if (operation === undefined || first === undefined) return;
    // Focus continues from the section's first row, which is the one that leaves.
    void operate(
      operation,
      section.entries.map((entry) => entry.path),
      first.key,
    );
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>, key: string): void {
    const index = items.findIndex((item) => item.key === key);
    const navigation = treeNavigation(event.key, flatItems, index);
    if (navigation === null) return;
    event.preventDefault();
    const target = items[navigation.index];
    if (target === undefined) return;
    switch (navigation.action) {
      case "focus":
        itemElements.current.get(target.key)?.focus();
        return;
      case "expand":
      case "collapse":
        if (target.kind === "section") {
          setCollapsed(target.section.id, navigation.action === "collapse");
        }
        return;
      case "open":
        return;
    }
  }

  const itemProps = {
    busy,
    register,
    onFocusItem: setRovingKey,
    onNavigate: navigate,
  };

  return (
    <div className="git-change-list" {...{ [GIT_CHANGE_LIST_ATTRIBUTE]: "" }}>
      <h2
        id={headingId}
        ref={heading}
        tabIndex={-1}
        className="git-visually-hidden"
        {...{ [GIT_CHANGE_HEADING_ATTRIBUTE]: "" }}
      >
        {messages.changeListLabel}
      </h2>
      {operating ? (
        <p role="status" className="git-panel__refreshing">
          {messages.operating}
        </p>
      ) : null}
      {sections.length === 0 ? (
        <p className="git-panel__message">{messages.noChanges}</p>
      ) : (
        <div
          role="tree"
          aria-labelledby={headingId}
          className="git-change-tree"
        >
          {items.map((item) =>
            item.kind === "section" ? (
              <GitSectionHeader
                key={item.key}
                itemKey={item.key}
                section={item.section}
                expanded={item.expanded}
                isRoving={item.key === effectiveRovingKey}
                onToggle={toggleSection}
                onOperateAll={operateOnSection}
                {...itemProps}
              />
            ) : (
              <GitFileRow
                key={item.key}
                entry={item.entry}
                isRoving={item.key === effectiveRovingKey}
                selected={
                  item.entry.selectionSide !== null &&
                  gitSelection?.path === item.entry.path &&
                  gitSelection.side === item.entry.selectionSide
                }
                onSelect={selectRow}
                onOperate={operateOnRow}
                {...itemProps}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function sectionIdOfKey(
  sections: readonly GitChangeSection[],
  key: string,
): GitChangeSectionId {
  const section = sections.find((candidate) =>
    candidate.entries.some((entry) => entry.key === key),
  );
  return section?.id ?? "changes";
}
