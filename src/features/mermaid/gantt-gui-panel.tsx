import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { GanttMoveDirection } from "../../domain/diagram/gantt/gantt-move-operations";
import type { GanttOperation } from "../../domain/diagram/gantt/gantt-operations";
import {
  type GanttSectionView,
  type GanttTaskView,
  readGanttMoveTargets,
  readGanttView,
} from "../../domain/diagram/gantt/gantt-view";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import { useMessages } from "../workspace/use-messages";
import {
  DiagramGuiLayout,
  GuiStatus,
  useGuiLayoutState,
} from "./diagram-gui-layout";
import { describeRefusal, describeRestriction } from "./diagram-gui-text";
import type { DiagramHit } from "./diagram-shapes";
import { GanttAddSection } from "./gantt-add-section";
import { GanttAddTask } from "./gantt-add-task";
import { GanttSectionEditor } from "./gantt-section-editor";
import { GanttSectionList } from "./gantt-section-list";
import { GanttSettingsEditor } from "./gantt-settings-editor";
import { GanttTaskEditor } from "./gantt-task-editor";
import { GanttTaskList } from "./gantt-task-list";
import { sectionKey, taskKey } from "./gantt-task-text";
import { GuiDraftLabelField } from "./gui-draft-label-field";
import {
  type DiagramOperationOutcome,
  type DiagramOperationTarget,
  useDiagramOperation,
} from "./use-diagram-operation";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface GanttGuiPanelProps {
  readonly target: DiagramOperationTarget;
  readonly shortId: string;
  // The block's committed text. The view is derived from it on every render.
  readonly source: string;
  // Filled with "get ready to show Source": commits what is pending in the text fields and
  // refuses while an add form holds input. See `leaveGui`.
  readonly leaveRef: MutableRefObject<GuiDraftCommit | null>;
}

// Which element is selected: a section or a task, by its position and the name it had when
// it was picked. Component state, separate from the canvas's block selection.
type GanttSelection =
  | { readonly kind: "section"; readonly index: number; readonly name: string }
  | {
      readonly kind: "task";
      readonly index: number;
      readonly name: string;
      readonly id: string | null;
    };

// The title field edits one thing, so its target is this constant.
const TITLE_TARGET = { key: "title" } as const;
// The list (tab) that shows each kind of selection, and the add forms.
const TABS = { section: "sections", task: "tasks" } as const;
const ADD = { section: "section", task: "task" } as const;

export function GanttGuiPanel({
  target,
  shortId,
  source,
  leaveRef,
}: GanttGuiPanelProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.gantt;
  const view = useMemo(() => readGanttView(source), [source]);
  const operation = useDiagramOperation(target);
  const { busy } = operation;
  const [selection, setSelection] = useState<GanttSelection | null>(null);
  // Counts the user's picks; the editor restarts its draft when it changes.
  const [selectionKey, setSelectionKey] = useState(0);
  const [inputError, setInputError] = useState<string | null>(null);
  const sectionListRef = useRef<HTMLDivElement>(null);
  const taskListRef = useRef<HTMLDivElement>(null);
  const editorNameRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const addSectionNameRef = useRef<HTMLInputElement | HTMLTextAreaElement>(
    null,
  );
  const commitPendingRef = useRef<GuiDraftCommit | null>(null);
  const titleCommitRef = useRef<GuiDraftCommit | null>(null);
  const settingsCommitRef = useRef<GuiDraftCommit | null>(null);
  const addSectionInputRef = useRef<(() => boolean) | null>(null);
  const layout = useGuiLayoutState(TABS.task);
  const addTaskInputRef = useRef<(() => boolean) | null>(null);
  // True from the moment this panel sends an operation until the view has followed it: only
  // then may a selected element whose name changed be looked up by its position (a rename
  // changes the name it is picked by). An undo, a redo or a Source edit never gets that
  // latitude, so the selection cannot quietly move to another element.
  const followEditRef = useRef(false);
  const { documentId, blockId } = target;

  // The selection is resolved against the committed text each time, so an undo, a redo or
  // an edit made in Source can never leave it pointing at a different element.
  const selectedSection = useMemo((): GanttSectionView | undefined => {
    if (selection?.kind !== "section" || view === null) return undefined;
    const exact = view.sections.find(
      (section) =>
        section.target.index === selection.index &&
        section.target.name === selection.name,
    );
    if (exact !== undefined || !followEditRef.current) return exact;
    // A rename keeps the position; a move keeps the (unique) name.
    return (
      view.sections.find((section) => section.target.name === selection.name) ??
      view.sections.find((section) => section.target.index === selection.index)
    );
  }, [selection, view]);
  const selectedTask = useMemo((): GanttTaskView | undefined => {
    if (selection?.kind !== "task" || view === null) return undefined;
    const exact = view.tasks.find(
      (task) =>
        task.target.index === selection.index &&
        task.target.name === selection.name,
    );
    if (exact !== undefined || !followEditRef.current) return exact;
    // A move keeps the id (unique), a rename keeps the id and a new id keeps the name: in
    // each case it is the same task.
    if (selection.id !== null) {
      const moved = view.tasks.find((task) => task.id === selection.id);
      if (moved !== undefined) return moved;
    }
    return view.tasks.find(
      (task) =>
        task.target.index === selection.index &&
        (task.id === selection.id || task.target.name === selection.name),
    );
  }, [selection, view]);

  // Once the view has followed an edit, the selection is anchored to the element as it is
  // now.
  useEffect(() => {
    if (selection?.kind === "section" && selectedSection !== undefined) {
      if (
        selectedSection.target.index !== selection.index ||
        selectedSection.target.name !== selection.name
      ) {
        setSelection({
          kind: "section",
          index: selectedSection.target.index,
          name: selectedSection.target.name,
        });
      }
      followEditRef.current = false;
    } else if (selection?.kind === "task" && selectedTask !== undefined) {
      if (
        selectedTask.target.index !== selection.index ||
        selectedTask.target.name !== selection.name ||
        selectedTask.id !== selection.id
      ) {
        setSelection({
          kind: "task",
          index: selectedTask.target.index,
          name: selectedTask.target.name,
          id: selectedTask.id,
        });
      }
      followEditRef.current = false;
    }
  }, [selection, selectedSection, selectedTask]);

  const run = useCallback(
    async (
      ganttOperation: GanttOperation,
    ): Promise<DiagramOperationOutcome> => {
      setInputError(null);
      followEditRef.current = true;
      const outcome = await operation.apply({
        diagram: "gantt",
        operation: ganttOperation,
      });
      if (outcome !== "applied") followEditRef.current = false;
      return outcome;
    },
    [operation],
  );
  const runDraft = useCallback(
    async (ganttOperation: GanttOperation) => {
      setInputError(null);
      followEditRef.current = true;
      const result = await operation.applyDraft({
        diagram: "gantt",
        operation: ganttOperation,
      });
      if (!result.ok) followEditRef.current = false;
      return result;
    },
    [operation],
  );

  async function commitPending(): Promise<OperationResult<void>> {
    const committed = await commitPendingRef.current?.();
    if (committed !== undefined && !committed.ok) return committed;
    return operationOk(undefined);
  }

  async function select(next: GanttSelection): Promise<void> {
    const committed = await commitPending();
    if (!committed.ok) return;
    setInputError(null);
    operation.clearRefusal();
    followEditRef.current = false;
    setSelectionKey((key) => key + 1);
    setSelection(next);
    layout.showTab(TABS[next.kind]);
  }

  // GUI -> Source. Pending text is committed (a refusal keeps it, and the switch). The add
  // forms are NOT committed: a view switch is not a request to add, so input there blocks
  // the switch with a message and stays.
  async function leaveGui(): Promise<OperationResult<void>> {
    if (
      addSectionInputRef.current?.() === true ||
      addTaskInputRef.current?.() === true
    ) {
      // A closed form may hold the input: it is opened, so what blocks is in view.
      layout.openAdd(
        addSectionInputRef.current?.() === true ? ADD.section : ADD.task,
      );
      setInputError(gui.addInputPending);
      return operationErr(
        "invalidDiagramOperation",
        "addInputPending: an add form has input",
      );
    }
    const pending = await commitPending();
    if (!pending.ok) return pending;
    const title = await titleCommitRef.current?.();
    if (title !== undefined && !title.ok) return title;
    const settings = await settingsCommitRef.current?.();
    if (settings !== undefined && !settings.ok) return settings;
    return operationOk(undefined);
  }
  useEffect(() => {
    leaveRef.current = leaveGui;
    return () => {
      leaveRef.current = null;
    };
  });

  // After a delete the element is gone, and so is the selection. The focus moves first,
  // because an element that is removed while focused would look like leaving the editor.
  async function deleteSelected(
    operationToRun: GanttOperation,
    listRef: MutableRefObject<HTMLDivElement | null>,
  ): Promise<void> {
    if (listRef.current !== null) listRef.current.focus();
    else layout.focusToolbar();
    const outcome = await run(operationToRun);
    if (outcome !== "applied") return;
    setSelectionKey((key) => key + 1);
    setSelection(null);
  }

  // Adding shifts positions, so the selection is dropped rather than guessed.
  function clearSelectionAfterAdd(): void {
    setSelectionKey((key) => key + 1);
    setSelection(null);
  }

  // A moved task keeps its id, and the selection follows it. Without an id there is nothing
  // to find it by (names repeat), so the selection is dropped instead of guessed.
  async function moveTask(
    task: GanttTaskView,
    ganttOperation: GanttOperation,
  ): Promise<void> {
    const outcome = await run(ganttOperation);
    if (outcome === "applied" && task.id === null) clearSelectionAfterAdd();
  }

  const moveTargets = useMemo(
    () =>
      selectedTask === undefined
        ? []
        : readGanttMoveTargets(source, selectedTask.target),
    [source, selectedTask],
  );

  // ---- the diagram picture: right-click and click on a task bar or a section row ----

  // The task a bar stands for: by the id the source gives it, else by its place (Mermaid
  // draws the bars in source order and makes up ids for tasks without one).
  function taskOf(hit: DiagramHit): GanttTaskView | undefined {
    if (hit.kind !== "task" || view === null) return undefined;
    const byId = view.tasks.find(
      (task) => task.id !== null && task.id === hit.id,
    );
    if (byId !== undefined) return byId;
    return hit.ordinal === undefined ? undefined : view.tasks[hit.ordinal];
  }

  function taskSelection(task: GanttTaskView): GanttSelection {
    return {
      kind: "task",
      index: task.target.index,
      name: task.target.name,
      id: task.id,
    };
  }

  async function editTaskFromDiagram(task: GanttTaskView): Promise<void> {
    await select(taskSelection(task));
    // The editor appears with the selection; its name field takes the focus then.
    requestAnimationFrame(() => editorNameRef.current?.focus());
  }

  async function deleteTaskFromDiagram(task: GanttTaskView): Promise<void> {
    const outcome = await run({ kind: "deleteTask", target: task.target });
    if (outcome !== "applied") return;
    setSelectionKey((key) => key + 1);
    setSelection(null);
  }

  // A section row: the stripe behind a task row stands for that task's section.
  function sectionOf(hit: DiagramHit): GanttSectionView | undefined {
    if (hit.kind !== "section" || hit.ordinal === undefined || view === null) {
      return undefined;
    }
    const task = view.tasks[hit.ordinal];
    return task === undefined ? undefined : view.sections[task.sectionIndex];
  }

  function sectionSelection(section: GanttSectionView): GanttSelection {
    return {
      kind: "section",
      index: section.target.index,
      name: section.target.name,
    };
  }

  async function editSectionFromDiagram(
    section: GanttSectionView,
  ): Promise<void> {
    await select(sectionSelection(section));
    // The editor appears with the selection; its name field takes the focus then.
    requestAnimationFrame(() => editorNameRef.current?.focus());
  }

  async function deleteSectionFromDiagram(
    section: GanttSectionView,
  ): Promise<void> {
    const outcome = await run({
      kind: "deleteSection",
      target: section.target,
    });
    if (outcome !== "applied") return;
    setSelectionKey((key) => key + 1);
    setSelection(null);
  }

  function shapeEntries(hit: DiagramHit): readonly PopupMenuEntry[] {
    const section = sectionOf(hit);
    if (section === undefined) return taskEntries(hit);
    return [
      {
        id: "editSection",
        label: text.editSectionMenu,
        onSelect: () => void editSectionFromDiagram(section),
      },
      {
        id: "deleteSection",
        label: text.deleteSectionMenu,
        disabled: busy || section.deleteRestriction !== null,
        onSelect: () => void deleteSectionFromDiagram(section),
      },
    ];
  }

  function taskEntries(hit: DiagramHit): readonly PopupMenuEntry[] {
    const task = taskOf(hit);
    if (task === undefined) return [];
    return [
      {
        id: "editTask",
        label: text.editTaskMenu,
        onSelect: () => void editTaskFromDiagram(task),
      },
      {
        id: "deleteTask",
        label: text.deleteTaskMenu,
        disabled: busy || task.deleteRestriction !== null,
        onSelect: () => void deleteTaskFromDiagram(task),
      },
    ];
  }

  if (view === null) return null;
  const refusal =
    operation.refusal === null
      ? null
      : describeRefusal(gui, operation.refusal, text.refusalReasons);
  const titleRestriction = describeRestriction(
    gui,
    view.titleRestriction,
    text.refusalReasons,
  );

  return (
    <DiagramGuiLayout
      className="diagram-gui__gantt"
      state={layout}
      source={source}
      shapeEntries={shapeEntries}
      onPickShape={(hit) => {
        const section = sectionOf(hit);
        const task = taskOf(hit);
        if (section !== undefined) void select(sectionSelection(section));
        else if (task !== undefined) void select(taskSelection(task));
      }}
      toolbarLabel={gui.addToolbarLabel}
      tabListLabel={gui.listTabsLabel}
      listsLabel={gui.listsSummary}
      settingsLabel={text.settingsHeading}
      addActions={[
        {
          id: ADD.section,
          label: text.addSectionToggle,
          menuLabel: text.addSectionHeading,
          form: (
            <GanttAddSection
              documentId={documentId}
              blockId={blockId}
              afterSectionIndex={
                selection?.kind === "section" && selectedSection !== undefined
                  ? selectedSection.target.index
                  : null
              }
              busy={busy}
              runDraft={async (ganttOperation) => {
                const result = await runDraft(ganttOperation);
                if (result.ok) clearSelectionAfterAdd();
                return result;
              }}
              nameInputRef={addSectionNameRef}
              hasInputRef={addSectionInputRef}
            />
          ),
        },
        {
          id: ADD.task,
          label: text.addTaskToggle,
          menuLabel: text.addTaskHeading,
          form: (
            <GanttAddTask
              documentId={documentId}
              blockId={blockId}
              sections={view.sections}
              dateFormat={view.dateFormat}
              busy={busy}
              runDraft={async (ganttOperation) => {
                const result = await runDraft(ganttOperation);
                if (result.ok) clearSelectionAfterAdd();
                return result;
              }}
              onInvalidInput={setInputError}
              hasInputRef={addTaskInputRef}
            />
          ),
        },
      ]}
      status={
        <GuiStatus
          busy={busy}
          busyText={gui.busy}
          refusalHeading={gui.refusalHeading}
          refusalDetailLabel={gui.refusalDetailLabel}
          message={inputError ?? refusal?.message ?? null}
          mermaidMessage={
            inputError === null ? (refusal?.mermaidMessage ?? null) : null
          }
        />
      }
      editor={
        <>
          {selection?.kind === "section" && (
            <GanttSectionEditor
              key={selectionKey}
              documentId={documentId}
              blockId={blockId}
              section={selectedSection}
              busy={busy}
              runDraft={runDraft}
              onInvalidInput={setInputError}
              onDelete={(section) =>
                void deleteSelected(
                  { kind: "deleteSection", target: section.target },
                  sectionListRef,
                )
              }
              onMove={(section, direction: GanttMoveDirection) =>
                void run({
                  kind: "moveSection",
                  target: section.target,
                  direction,
                })
              }
              nameInputRef={editorNameRef}
              commitPendingRef={commitPendingRef}
            />
          )}
          {selection?.kind === "task" && (
            <GanttTaskEditor
              key={selectionKey}
              documentId={documentId}
              blockId={blockId}
              task={selectedTask}
              dateFormat={view.dateFormat}
              busy={busy}
              runDraft={runDraft}
              onInvalidInput={setInputError}
              onDelete={(task) =>
                void deleteSelected(
                  { kind: "deleteTask", target: task.target },
                  taskListRef,
                )
              }
              onMove={(task, direction: GanttMoveDirection) =>
                void moveTask(task, {
                  kind: "moveTask",
                  target: task.target,
                  direction,
                })
              }
              onMoveToSection={(task, sectionIndex) =>
                void moveTask(task, {
                  kind: "moveTaskToSection",
                  target: task.target,
                  sectionIndex,
                })
              }
              onDuplicate={(task) =>
                void run({ kind: "duplicateTask", target: task.target })
              }
              moveTargets={moveTargets}
              nameInputRef={editorNameRef}
              commitPendingRef={commitPendingRef}
            />
          )}
        </>
      }
      tabs={[
        {
          id: TABS.task,
          label: text.tasksHeading,
          count: view.tasks.length,
          content: (
            <GanttTaskList
              shortId={shortId}
              tasks={view.tasks}
              selectedKey={
                selection?.kind === "task" && selectedTask !== undefined
                  ? taskKey(selectedTask)
                  : null
              }
              onSelect={(key) => {
                const task = view.tasks.find(
                  (candidate) => taskKey(candidate) === key,
                );
                if (task !== undefined) {
                  void select({
                    kind: "task",
                    index: task.target.index,
                    name: task.target.name,
                    id: task.id,
                  });
                }
              }}
              onEnter={() => editorNameRef.current?.focus()}
              listRef={taskListRef}
            />
          ),
        },
        {
          id: TABS.section,
          label: text.sectionsHeading,
          count: view.sections.length,
          content: (
            <GanttSectionList
              shortId={shortId}
              sections={view.sections}
              selectedKey={
                selection?.kind === "section" && selectedSection !== undefined
                  ? sectionKey(selectedSection)
                  : null
              }
              onSelect={(key) => {
                const section = view.sections.find(
                  (candidate) => sectionKey(candidate) === key,
                );
                if (section !== undefined) {
                  void select({
                    kind: "section",
                    index: section.target.index,
                    name: section.target.name,
                  });
                }
              }}
              onEnter={() => editorNameRef.current?.focus()}
              listRef={sectionListRef}
            />
          ),
        },
      ]}
      settings={
        <section
          aria-label={text.settingsHeading}
          className="diagram-gui__settings"
        >
          <GuiDraftLabelField
            documentId={documentId}
            blockId={blockId}
            label={text.titleField}
            target={TITLE_TARGET}
            targetKey={(titleTarget) => titleTarget.key}
            committed={view.title}
            buildOperation={(_titleTarget, title): GanttOperation =>
              title === ""
                ? { kind: "clearTitle" }
                : { kind: "setTitle", title }
            }
            allowEmpty
            multiline={false}
            restrictionText={titleRestriction}
            itemChangedText={text.itemChanged}
            busy={busy}
            runDraft={runDraft}
            onInvalidInput={setInputError}
            inputRef={null}
            commitPendingRef={titleCommitRef}
          />
          <p className="diagram-gui__hint">
            {text.dateFormatLine(view.dateFormat)}
          </p>
          <GanttSettingsEditor
            documentId={documentId}
            blockId={blockId}
            view={view}
            busy={busy}
            runDraft={runDraft}
            onInvalidInput={setInputError}
            commitPendingRef={settingsCommitRef}
          />
        </section>
      }
    />
  );
}
