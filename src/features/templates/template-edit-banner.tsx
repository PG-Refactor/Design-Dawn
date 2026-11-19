import { useEffect, useId, useRef } from "react";
import { createStore } from "../../shared/store/store";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { Modal } from "../workspace/modal";
import { isSaveAllShortcut, isSaveShortcut } from "../workspace/save-shortcut";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./template-dialogs.css";

export type TemplateCloseChoice = "save" | "discard" | "cancel";

const closeQuestion = createStore<{
  readonly answer: ((choice: TemplateCloseChoice) => void) | null;
}>({ answer: null });

// Asked when an editing window closes with changes not written back to the template.
export function askTemplateEditClose(): Promise<TemplateCloseChoice> {
  closeQuestion.getState().answer?.("cancel");
  return new Promise((resolve) => {
    closeQuestion.setState(() => ({
      answer: (choice) => {
        closeQuestion.setState(() => ({ answer: null }));
        resolve(choice);
      },
    }));
  });
}

function CloseDialog() {
  const answer = useStoreSelector(closeQuestion, (state) => state.answer);
  const messages = useMessages().templates;
  const titleId = useId();
  const saveRef = useRef<HTMLButtonElement>(null);
  if (answer === null) return null;
  return (
    <Modal
      titleId={titleId}
      onCancel={() => answer("cancel")}
      initialFocusRef={saveRef}
    >
      <h2 id={titleId} className="modal__title">
        {messages.closeEditTitle}
      </h2>
      <p>{messages.closeEditQuestion}</p>
      <div className="modal__actions">
        <button
          type="button"
          className="button"
          onClick={() => answer("cancel")}
        >
          {messages.cancel}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => answer("discard")}
        >
          {messages.closeWithoutSaving}
        </button>
        <button
          ref={saveRef}
          type="button"
          className="button button--primary"
          onClick={() => answer("save")}
        >
          {messages.saveAndClose}
        </button>
      </div>
    </Modal>
  );
}

// Shown in a window that edits a Custom Template: what is edited, and saving it back
// (also Ctrl/Cmd+S, next to the usual save of the window's own working copy).
export function TemplateEditBanner() {
  const { templateEditor } = useWorkspaceServices();
  const state = useStoreSelector(templateEditor.store, (current) => current);
  const messages = useMessages().templates;
  const latestEditor = useRef(templateEditor);
  latestEditor.current = templateEditor;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Save and Save All both write the template back: the window holds nothing else.
      const save = isSaveShortcut(event) || isSaveAllShortcut(event);
      if (!save || !latestEditor.current.isEditing()) return;
      void latestEditor.current.save();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
  // An open question goes with the shell.
  useEffect(() => () => closeQuestion.getState().answer?.("cancel"), []);

  if (state.editing === null) return <CloseDialog />;
  const { editing } = state;
  return (
    <>
      <section
        aria-label={messages.editRegion}
        className="template-edit-banner"
      >
        <span className="template-edit-banner__text">
          {messages.editingBanner(
            editing.name,
            messages.kinds[editing.kind],
            messages.scopeShort[editing.scope],
          )}
        </span>
        {state.savedAt !== null && !state.saving && (
          <span role="status" className="template-edit-banner__status">
            {messages.savedTemplate}
          </span>
        )}
        <button
          type="button"
          className="button button--primary"
          disabled={state.saving}
          onClick={() => void templateEditor.save()}
        >
          {state.saving ? messages.savingTemplate : messages.saveTemplate}
        </button>
      </section>
      <CloseDialog />
    </>
  );
}
