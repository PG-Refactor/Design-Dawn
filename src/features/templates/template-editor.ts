// A window that edits a Custom Template: its Project was made for the template (in the
// app's local data). The window fills it from the template once, and "Save Template"
// (or Ctrl+S) writes what it holds back into the template. Whether there is anything not
// written back is told by comparing the template the window would write now with the one
// written last.

import type { OperationResult } from "../../application/ports/operation-error";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type {
  TemplateGateway,
  TemplateKind,
  TemplateScope,
} from "../../application/ports/template-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { DocumentId, ProjectId } from "../../domain/shared/entity-id";
import { createStore, type Store } from "../../shared/store/store";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import type { UiStateStore } from "../workspace/ui-state/ui-state";
import type { WorkspaceActions } from "../workspace/workspace-actions";
import type { CustomTemplates } from "./custom-templates";

export interface EditedTemplate {
  readonly scope: TemplateScope;
  readonly kind: TemplateKind;
  readonly templateId: string;
  readonly name: string;
}

export interface TemplateEditorState {
  // Null: an ordinary window.
  readonly editing: EditedTemplate | null;
  readonly saving: boolean;
  // When the template was last written back from this window.
  readonly savedAt: number | null;
}

export interface TemplateEditor {
  readonly store: Store<TemplateEditorState>;
  isEditing(): boolean;
  save(): Promise<OperationResult<void>>;
  hasUnsavedChanges(): Promise<boolean>;
}

export interface TemplateEditorDependencies {
  readonly gateway: TemplateGateway;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly templates: Pick<CustomTemplates, "capture" | "fillForEditing">;
  readonly actions: Pick<WorkspaceActions, "saveAll">;
}

const SAVE_LABEL = "saveTemplate";

export function createTemplateEditor({
  gateway,
  applicationStore,
  uiStateStore,
  templates,
  actions,
}: TemplateEditorDependencies): TemplateEditor {
  const store = createStore<TemplateEditorState>({
    editing: null,
    saving: false,
    savedAt: null,
  });
  // What the template held when it was last written (or when the window filled it).
  let written: string | null = null;

  function projectId(): ProjectId | null {
    return applicationStore.getState().project?.projectId ?? null;
  }

  // The window's one Document (the one the template was filled into).
  function documentId(): DocumentId | null {
    const [first] = applicationStore.getState().documents.keys();
    return first ?? null;
  }

  async function snapshot(): Promise<OperationResult<string>> {
    const editing = store.getState().editing;
    const document = documentId();
    if (editing === null || document === null) {
      return operationErr("entityNotFound", "no template is being edited");
    }
    const content = await templates.capture(
      document,
      editing.kind,
      editing.name,
    );
    return content.ok ? operationOk(JSON.stringify(content.value)) : content;
  }

  async function start(project: ProjectId): Promise<void> {
    const info = await gateway.templateEditInfo(project);
    if (!info.ok || info.value === null) return;
    const { scope, kind, templateId, name } = info.value;
    store.setState((state) => ({
      ...state,
      editing: { scope, kind, templateId, name },
    }));
    const filled = await templates.fillForEditing(
      info.value,
      (document, asset) =>
        gateway.importTemplateEditAsset(project, document, asset),
    );
    if (!filled.ok) {
      uiStateStore.setState((state) =>
        addOperationError(state, SAVE_LABEL, name, filled.error),
      );
      return;
    }
    // The Project made for editing is only a working copy: keep its files current so a
    // closed and reopened window shows what it holds.
    await actions.saveAll();
    const now = await snapshot();
    written = now.ok ? now.value : null;
  }

  let shownProject: ProjectId | null = null;
  applicationStore.subscribe(() => {
    const current = projectId();
    if (current === shownProject) return;
    shownProject = current;
    store.setState(() => ({ editing: null, saving: false, savedAt: null }));
    written = null;
    if (current !== null) void start(current);
  });

  return {
    store,
    isEditing: () => store.getState().editing !== null,

    async save() {
      const editing = store.getState().editing;
      const project = projectId();
      const document = documentId();
      if (editing === null || project === null || document === null) {
        return operationOk(undefined);
      }
      store.setState((state) => ({ ...state, saving: true }));
      try {
        await actions.saveAll();
        const content = await templates.capture(
          document,
          editing.kind,
          editing.name,
        );
        const saved = content.ok
          ? await gateway.saveTemplateEdit(project, document, content.value)
          : content;
        if (!saved.ok) {
          uiStateStore.setState((state) =>
            addOperationError(state, SAVE_LABEL, editing.name, saved.error),
          );
          return saved;
        }
        written = content.ok ? JSON.stringify(content.value) : written;
        store.setState((state) => ({ ...state, savedAt: Date.now() }));
        return operationOk(undefined);
      } finally {
        store.setState((state) => ({ ...state, saving: false }));
      }
    },

    async hasUnsavedChanges() {
      if (store.getState().editing === null) return false;
      const now = await snapshot();
      // Unreadable: better to ask than to lose the edits.
      return !now.ok || now.value !== written;
    },
  };
}
