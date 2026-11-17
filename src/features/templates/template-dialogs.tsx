import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  TEMPLATE_KINDS,
  TEMPLATE_SCOPES,
  type TemplateKind,
  type TemplateScope,
  type TemplateSummary,
} from "../../application/ports/template-gateway";
import { createStore } from "../../shared/store/store";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { Modal } from "../workspace/modal";
import { NameDialog } from "../workspace/name-dialog";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./template-dialogs.css";

// Saving goes to the person's own templates of every Project unless they choose otherwise:
// sharing through Git is a deliberate choice.
const DEFAULT_SCOPE: TemplateScope = "global";

export interface SaveTemplateAnswer {
  readonly name: string;
  readonly scope: TemplateScope;
}

interface Question<Request, Answer> {
  readonly request: Request | null;
  readonly answer: ((value: Answer | null) => void) | null;
}

// One question of a kind at a time; a new one answers an open one as cancelled.
function createQuestion<Request, Answer>() {
  const store = createStore<Question<Request, Answer>>({
    request: null,
    answer: null,
  });
  function ask(request: Request): Promise<Answer | null> {
    store.getState().answer?.(null);
    return new Promise((resolve) => {
      store.setState(() => ({
        request,
        answer: (value) => {
          store.setState(() => ({ request: null, answer: null }));
          resolve(value);
        },
      }));
    });
  }
  return { store, ask };
}

const saveQuestion = createQuestion<
  { readonly kind: TemplateKind; readonly name: string },
  SaveTemplateAnswer
>();
const documentNameQuestion = createQuestion<
  { readonly templateName: string; readonly name: string },
  string
>();
const manager = createStore<{ readonly open: boolean }>({ open: false });

// The name and place of a new template of `kind` (null: cancelled).
export const askSaveTemplate = saveQuestion.ask;
// The name of a Document made from a template (null: cancelled).
export const askTemplateDocumentName = documentNameQuestion.ask;
export function openTemplateManager(): void {
  manager.setState(() => ({ open: true }));
}

function SaveTemplateDialog() {
  const { request, answer } = useStoreSelector(
    saveQuestion.store,
    (state) => state,
  );
  if (request === null || answer === null) return null;
  return (
    <SaveForm
      key={`${request.kind}:${request.name}`}
      kind={request.kind}
      initialName={request.name}
      onAnswer={answer}
    />
  );
}

function SaveForm({
  kind,
  initialName,
  onAnswer,
}: {
  readonly kind: TemplateKind;
  readonly initialName: string;
  readonly onAnswer: (value: SaveTemplateAnswer | null) => void;
}) {
  const messages = useMessages().templates;
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [scope, setScope] = useState<TemplateScope>(DEFAULT_SCOPE);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (name.trim() === "") {
      setError(messages.nameRequired);
      inputRef.current?.focus();
      return;
    }
    onAnswer({ name: name.trim(), scope });
  }

  return (
    <Modal
      titleId={titleId}
      onCancel={() => onAnswer(null)}
      initialFocusRef={inputRef}
    >
      <h2 id={titleId} className="modal__title">
        {messages.saveTitle(messages.kinds[kind])}
      </h2>
      <form onSubmit={submit} noValidate className="template-dialog">
        <label htmlFor={inputId} className="template-dialog__label">
          {messages.nameLabel}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          className="template-dialog__input"
          type="text"
          value={name}
          autoComplete="off"
          aria-invalid={error !== null}
          onChange={(event) => setName(event.target.value)}
        />
        {error !== null && (
          <p role="alert" className="template-dialog__error">
            {error}
          </p>
        )}
        <fieldset className="template-dialog__scopes">
          <legend>{messages.scopeLegend}</legend>
          {TEMPLATE_SCOPES.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="template-scope"
                checked={scope === option}
                onChange={() => setScope(option)}
              />
              {messages.scopes[option]}
            </label>
          ))}
        </fieldset>
        <div className="modal__actions">
          <button
            type="button"
            className="button"
            onClick={() => onAnswer(null)}
          >
            {messages.cancel}
          </button>
          <button type="submit" className="button button--primary">
            {messages.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DocumentNameDialog() {
  const messages = useMessages();
  const { request, answer } = useStoreSelector(
    documentNameQuestion.store,
    (state) => state,
  );
  if (request === null || answer === null) return null;
  return (
    <NameDialog
      key={request.templateName}
      title={messages.templates.documentNameTitle(request.templateName)}
      nameLabel={messages.templates.documentNameLabel}
      submitLabel={messages.templates.create}
      initialName={request.name}
      busy={false}
      onCancel={() => answer(null)}
      onSubmit={(name) => answer(name)}
    />
  );
}

function TemplateRow({ template }: { readonly template: TemplateSummary }) {
  const messages = useMessages().templates;
  const { templates } = useWorkspaceServices();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (confirmingDelete) {
    return (
      <li className="template-manager__row">
        <span className="template-manager__question">
          {messages.deleteConfirm(template.name)}
        </span>
        <button
          type="button"
          className="button"
          onClick={() => setConfirmingDelete(false)}
        >
          {messages.cancel}
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={() => void templates.remove(template)}
        >
          {messages.delete}
        </button>
      </li>
    );
  }
  return (
    <li className="template-manager__row">
      {renaming === null ? (
        <span className="template-manager__name">{template.name}</span>
      ) : (
        <form
          className="template-manager__name"
          onSubmit={(event) => {
            event.preventDefault();
            if (renaming.trim() === "") return;
            void templates
              .rename(template, renaming.trim())
              .then(() => setRenaming(null));
          }}
        >
          <input
            className="template-dialog__input"
            aria-label={messages.nameLabel}
            value={renaming}
            onChange={(event) => setRenaming(event.target.value)}
          />
          <button type="submit" className="button">
            {messages.renameDone}
          </button>
        </form>
      )}
      <select
        aria-label={messages.moveTo}
        className="template-manager__scope"
        value={template.scope}
        onChange={(event) => {
          const to = TEMPLATE_SCOPES.find(
            (scope) => scope === event.target.value,
          );
          if (to !== undefined) void templates.move(template, to);
        }}
      >
        {TEMPLATE_SCOPES.map((scope) => (
          <option key={scope} value={scope}>
            {messages.scopeShort[scope]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="button"
        onClick={() => void templates.openEditor(template)}
      >
        {messages.edit}
      </button>
      {renaming === null && (
        <button
          type="button"
          className="button"
          onClick={() => setRenaming(template.name)}
        >
          {messages.rename}
        </button>
      )}
      <button
        type="button"
        className="button"
        onClick={() => setConfirmingDelete(true)}
      >
        {messages.delete}
      </button>
    </li>
  );
}

function TemplateManagerDialog() {
  const open = useStoreSelector(manager, (state) => state.open);
  const { templates } = useWorkspaceServices();
  const list = useStoreSelector(templates.store, (state) => state);
  const messages = useMessages().templates;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  // The list is read again when the manager opens (a template may have been added by
  // hand or by Git meanwhile).
  useEffect(() => {
    if (open) void templates.refresh();
  }, [open, templates]);
  if (!open) return null;
  const close = () => manager.setState(() => ({ open: false }));
  return (
    <Modal titleId={titleId} onCancel={close} initialFocusRef={closeRef} wide>
      <h2 id={titleId} className="modal__title">
        {messages.manageTitle}
      </h2>
      <div className="modal__body template-manager">
        {list.templates.length === 0 ? (
          <p>{messages.emptyList}</p>
        ) : (
          TEMPLATE_KINDS.map((kind) => {
            const ofKind = list.templates.filter(
              (template) => template.kind === kind,
            );
            if (ofKind.length === 0) return null;
            return (
              <section key={kind} aria-label={messages.kinds[kind]}>
                <h3 className="template-manager__kind">
                  {messages.kinds[kind]}
                </h3>
                <ul className="template-manager__list">
                  {ofKind.map((template) => (
                    <TemplateRow
                      key={`${template.scope}:${template.templateId}`}
                      template={template}
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}
        {list.issues.length > 0 && (
          <p role="status" className="template-dialog__error">
            {messages.issues(list.issues.length)}
          </p>
        )}
      </div>
      <div className="modal__actions">
        <button
          ref={closeRef}
          type="button"
          className="button button--primary"
          onClick={close}
        >
          {messages.close}
        </button>
      </div>
    </Modal>
  );
}

// Every template dialog, rendered once by the shell.
export function TemplateDialogs() {
  // An open question goes with the shell (answered as cancelled, so nothing waits).
  useEffect(
    () => () => {
      saveQuestion.store.getState().answer?.(null);
      documentNameQuestion.store.getState().answer?.(null);
      manager.setState(() => ({ open: false }));
    },
    [],
  );
  return (
    <>
      <SaveTemplateDialog />
      <DocumentNameDialog />
      <TemplateManagerDialog />
    </>
  );
}
