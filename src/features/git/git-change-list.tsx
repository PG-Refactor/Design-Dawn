import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GitStatus } from "../../application/ports/git-gateway";
import { useMessages } from "../workspace/use-messages";
import { NAVIGATION_KEYS } from "../workspace/view-models/keyboard-navigation";
import { useGitState, useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import {
  deriveGitChangeSections,
  focusKeyAfterChange,
  type GitChangeEntry,
  type GitChangeSection,
  type GitChangeSectionId,
  type GitChangeSection as Section,
} from "./git-change-sections";
import { openDiff, refreshDiffAfterStatusChange } from "./git-diff-session";
import {
  GIT_CHANGE_HEADING_ATTRIBUTE,
  GIT_CHANGE_LIST_ATTRIBUTE,
} from "./git-dom";
import type { GitMessages } from "./git-messages";

type IndexOperation = "stage" | "unstage";

// Which operation and button text a section offers; conflicts offer none.
const SECTION_OPERATIONS: Record<
  GitChangeSectionId,
  {
    readonly operation: IndexOperation;
    // Keys of the catalog, so the labels follow the display language.
    readonly rowLabelKey: "stage" | "unstage";
    readonly allLabelKey: "stageAll" | "unstageAll";
  } | null
> = {
  staged: {
    operation: "unstage",
    rowLabelKey: "unstage",
    allLabelKey: "unstageAll",
  },
  changes: {
    operation: "stage",
    rowLabelKey: "stage",
    allLabelKey: "stageAll",
  },
  untracked: {
    operation: "stage",
    rowLabelKey: "stage",
    allLabelKey: "stageAll",
  },
  conflicts: null,
};

interface FocusRequest {
  readonly before: readonly Section[];
  readonly actedKey: string;
}

interface ChangeRowProps {
  readonly entry: GitChangeEntry;
  readonly isRoving: boolean;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly register: (key: string, element: HTMLDivElement | null) => void;
  readonly onFocusRow: (key: string) => void;
  readonly onSelect: (entry: GitChangeEntry) => void;
  readonly onNavigate: (
    event: KeyboardEvent<HTMLDivElement>,
    key: string,
  ) => void;
  readonly onOperate: (entry: GitChangeEntry) => void;
}

function ChangeRow({
  entry,
  isRoving,
  selected,
  busy,
  register,
  onFocusRow,
  onSelect,
  onNavigate,
  onOperate,
}: ChangeRowProps) {
  const messages = useMessages().git;
  const kindId = useId();
  const pathId = useId();
  const kind =
    messages.changeKinds[entry.change as keyof GitMessages["changeKinds"]];
  const operation = SECTION_OPERATIONS[entry.sectionId];
  // Paths are repository text: only ever rendered as React text.
  const pathText =
    entry.originalPath === null
      ? entry.path
      : messages.renamedPathText(entry.originalPath, entry.path);

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button") !== null) return;
    event.currentTarget.focus();
    onSelect(entry);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // Keys pressed in the row's button belong to the button.
    if (event.target !== event.currentTarget) return;
    if (event.key === NAVIGATION_KEYS.enter) {
      event.preventDefault();
      onSelect(entry);
      return;
    }
    onNavigate(event, entry.key);
  }

  return (
    <div
      ref={(element) => register(entry.key, element)}
      role="option"
      aria-labelledby={`${kindId} ${pathId}`}
      aria-selected={entry.selectionSide === null ? undefined : selected}
      tabIndex={isRoving ? 0 : -1}
      className={
        selected ? "git-change-row git-change-row--selected" : "git-change-row"
      }
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusRow(entry.key);
      }}
    >
      <span
        id={kindId}
        role="img"
        className="git-change-row__kind"
        aria-label={kind.label}
      >
        {kind.letter}
      </span>
      <span id={pathId} className="git-change-row__path">
        {pathText}
      </span>
      {operation === null ? (
        <span className="git-change-row__note">{messages.conflictNote}</span>
      ) : (
        <button
          type="button"
          className="button"
          disabled={busy}
          tabIndex={isRoving ? 0 : -1}
          aria-describedby={pathId}
          onClick={() => onOperate(entry)}
        >
          {messages[operation.rowLabelKey]}
        </button>
      )}
    </div>
  );
}

// The change list of a ready repository: the sections of the status, row selection and
// Stage / Unstage. It only derives from the Git status; the status is replaced by the
// answer of the Git controller, never edited here.
export function GitChangeList({ status }: { readonly status: GitStatus }) {
  const messages = useMessages().git;
  const services = useWorkspaceServices();
  const { gitController } = services;
  const operating = useGitState((git) => git.operating);
  const refreshing = useGitState((git) => git.refreshing);
  const gitSelection = useUiState((ui) => ui.gitSelection);
  const sections = useMemo(() => deriveGitChangeSections(status), [status]);
  const rows = useMemo(
    () => sections.flatMap((section) => section.entries),
    [sections],
  );
  const busy = operating || refreshing;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement | null>(null);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const [rovingKey, setRovingKey] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const effectiveRovingKey = rows.some((row) => row.key === rovingKey)
    ? rovingKey
    : (rows[0]?.key ?? null);

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
    setRovingKey(key);
    rowElements.current.get(key)?.focus();
  }, [focusRequest, sections]);

  function register(key: string, element: HTMLDivElement | null): void {
    if (element === null) rowElements.current.delete(key);
    else rowElements.current.set(key, element);
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
    const index = rows.findIndex((row) => row.key === key);
    let target: number;
    switch (event.key) {
      case NAVIGATION_KEYS.arrowUp:
        target = Math.max(index - 1, 0);
        break;
      case NAVIGATION_KEYS.arrowDown:
        target = Math.min(index + 1, rows.length - 1);
        break;
      case NAVIGATION_KEYS.home:
        target = 0;
        break;
      case NAVIGATION_KEYS.end:
        target = rows.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const row = rows[target];
    if (row !== undefined) rowElements.current.get(row.key)?.focus();
  }

  return (
    <div className="git-change-list" {...{ [GIT_CHANGE_LIST_ATTRIBUTE]: "" }}>
      <h2
        ref={heading}
        tabIndex={-1}
        className="git-change-list__heading"
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
      ) : null}
      {sections.map((section) => {
        const operation = SECTION_OPERATIONS[section.id];
        const title = messages.sectionTitles[section.id];
        return (
          <section
            key={section.id}
            className="git-change-section"
            aria-labelledby={`${headingId}-${section.id}`}
          >
            <header className="git-change-section__header">
              <h3
                id={`${headingId}-${section.id}`}
                className="git-change-section__title"
              >
                {title}
              </h3>
              {operation === null ? null : (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => operateOnSection(section)}
                >
                  {messages[operation.allLabelKey]}
                </button>
              )}
            </header>
            <div
              role="listbox"
              aria-label={title}
              className="git-change-section__rows"
            >
              {section.entries.map((entry) => (
                <ChangeRow
                  key={entry.key}
                  entry={entry}
                  isRoving={entry.key === effectiveRovingKey}
                  selected={
                    entry.selectionSide !== null &&
                    gitSelection?.path === entry.path &&
                    gitSelection.side === entry.selectionSide
                  }
                  busy={busy}
                  register={register}
                  onFocusRow={setRovingKey}
                  onSelect={selectRow}
                  onNavigate={navigate}
                  onOperate={operateOnRow}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
