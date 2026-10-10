import { type KeyboardEvent, type MouseEvent, useId } from "react";
import { useMessages } from "../workspace/use-messages";
import { NAVIGATION_KEYS } from "../workspace/view-models/keyboard-navigation";
import { splitGitPath } from "./git-change-path";
import type {
  GitChangeEntry,
  GitChangeSection,
  GitChangeSectionId,
} from "./git-change-sections";
import { ChevronIcon, MinusIcon, PlusIcon } from "./git-icons";
import type { GitMessages } from "./git-messages";

export type IndexOperation = "stage" | "unstage";

// Which operation a section offers and the catalog keys of its labels; conflicts offer none.
export const SECTION_OPERATIONS: Record<
  GitChangeSectionId,
  {
    readonly operation: IndexOperation;
    readonly rowLabelKey: "stage" | "unstage";
    readonly allLabelKey: "stageAll" | "unstageAll";
  } | null
> = {
  conflicts: null,
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
};

function OperationIcon({ operation }: { readonly operation: IndexOperation }) {
  return operation === "stage" ? <PlusIcon /> : <MinusIcon />;
}

// Keys pressed inside an item's own button belong to that button.
function isOwnKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.target === event.currentTarget;
}

function isActivationKey(key: string): boolean {
  return key === NAVIGATION_KEYS.enter || key === NAVIGATION_KEYS.space;
}

interface ItemProps {
  readonly isRoving: boolean;
  readonly busy: boolean;
  readonly register: (key: string, element: HTMLDivElement | null) => void;
  readonly onFocusItem: (key: string) => void;
  readonly onNavigate: (
    event: KeyboardEvent<HTMLDivElement>,
    key: string,
  ) => void;
}

interface SectionHeaderProps extends ItemProps {
  readonly itemKey: string;
  readonly section: GitChangeSection;
  readonly expanded: boolean;
  readonly onToggle: (sectionId: GitChangeSectionId) => void;
  readonly onOperateAll: (section: GitChangeSection) => void;
}

export function GitSectionHeader({
  itemKey,
  section,
  expanded,
  isRoving,
  busy,
  register,
  onFocusItem,
  onNavigate,
  onToggle,
  onOperateAll,
}: SectionHeaderProps) {
  const messages = useMessages().git;
  const titleId = useId();
  const countId = useId();
  const operation = SECTION_OPERATIONS[section.id];
  const title = messages.sectionTitles[section.id];
  const count = section.entries.length;

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button") !== null) return;
    event.currentTarget.focus();
    onToggle(section.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!isOwnKey(event)) return;
    if (isActivationKey(event.key)) {
      event.preventDefault();
      onToggle(section.id);
      return;
    }
    onNavigate(event, itemKey);
  }

  return (
    <div
      ref={(element) => register(itemKey, element)}
      role="treeitem"
      aria-level={1}
      aria-expanded={expanded}
      aria-labelledby={`${titleId} ${countId}`}
      tabIndex={isRoving ? 0 : -1}
      className="git-tree-item git-section-header"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusItem(itemKey);
      }}
    >
      <span className="git-section-header__chevron" aria-hidden="true">
        <ChevronIcon />
      </span>
      <span id={titleId} className="git-section-header__title">
        {title}
      </span>
      <span className="git-tree-item__actions">
        {operation === null ? null : (
          <button
            type="button"
            className="git-icon-button"
            disabled={busy}
            tabIndex={isRoving ? 0 : -1}
            aria-label={messages[operation.allLabelKey]}
            title={messages[operation.allLabelKey]}
            onClick={() => onOperateAll(section)}
          >
            <OperationIcon operation={operation.operation} />
          </button>
        )}
      </span>
      <span className="git-count-badge" aria-hidden="true">
        {count}
      </span>
      <span id={countId} className="git-visually-hidden">
        {messages.countLabel(count)}
      </span>
    </div>
  );
}

interface FileRowProps extends ItemProps {
  readonly entry: GitChangeEntry;
  readonly selected: boolean;
  readonly onSelect: (entry: GitChangeEntry) => void;
  readonly onPin: (entry: GitChangeEntry) => void;
  readonly onOperate: (entry: GitChangeEntry) => void;
}

export function GitFileRow({
  entry,
  isRoving,
  selected,
  busy,
  register,
  onFocusItem,
  onNavigate,
  onSelect,
  onPin,
  onOperate,
}: FileRowProps) {
  const messages = useMessages().git;
  const nameId = useId();
  const kind =
    messages.changeKinds[entry.change as keyof GitMessages["changeKinds"]];
  const operation = SECTION_OPERATIONS[entry.sectionId];
  // Paths are repository text: only ever rendered as React text.
  const fullPathText =
    entry.originalPath === null
      ? entry.path
      : messages.renamedPathText(entry.originalPath, entry.path);
  const { name, directory } = splitGitPath(entry.path);
  const classNames = ["git-tree-item", "git-file-row"];
  if (selected) classNames.push("git-file-row--selected");
  if (entry.change === "deleted") classNames.push("git-file-row--deleted");

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button") !== null) return;
    event.currentTarget.focus();
    onSelect(entry);
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("button") !== null) {
      return;
    }
    onPin(entry);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!isOwnKey(event)) return;
    if (isActivationKey(event.key)) {
      event.preventDefault();
      onSelect(entry);
      return;
    }
    onNavigate(event, entry.key);
  }

  return (
    <div
      ref={(element) => register(entry.key, element)}
      role="treeitem"
      aria-level={2}
      aria-label={`${kind.label} ${fullPathText}`}
      aria-selected={entry.selectionSide === null ? undefined : selected}
      title={fullPathText}
      tabIndex={isRoving ? 0 : -1}
      className={classNames.join(" ")}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusItem(entry.key);
      }}
    >
      <span id={nameId} className="git-file-row__name">
        {name}
      </span>
      {directory === "" ? null : (
        <span className="git-file-row__directory">{directory}</span>
      )}
      <span className="git-tree-item__actions">
        {operation === null ? null : (
          <button
            type="button"
            className="git-icon-button"
            disabled={busy}
            tabIndex={isRoving ? 0 : -1}
            aria-label={messages[operation.rowLabelKey]}
            title={messages[operation.rowLabelKey]}
            aria-describedby={nameId}
            onClick={() => onOperate(entry)}
          >
            <OperationIcon operation={operation.operation} />
          </button>
        )}
      </span>
      {operation === null ? (
        <span className="git-file-row__note">{messages.conflictNote}</span>
      ) : null}
      <span
        role="img"
        className={`git-file-row__kind git-file-row__kind--${entry.change}`}
        aria-label={kind.label}
        title={kind.label}
      >
        {kind.letter}
      </span>
    </div>
  );
}
