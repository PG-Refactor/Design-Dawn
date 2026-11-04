import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { parseProjectFolderName } from "../../domain/project/project-folder-name";
import { parseDisplayName } from "../../domain/shared/display-name";
import { Modal } from "./modal";
import type { NewProjectRequest } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import type { ProjectLocation } from "./workspace-actions";
import { describeInvalidName } from "./workspace-messages";
import "./name-dialog.css";
import "./create-project-dialog.css";

export interface CreateProjectDialogProps {
  readonly busy: boolean;
  // The default place, when one is set (null otherwise).
  readonly loadDefaultLocation: () => Promise<ProjectLocation | null>;
  // The folder dialog; null when it was cancelled.
  readonly chooseLocation: () => Promise<ProjectLocation | null>;
  // Called only with values that passed the domain validation.
  readonly onSubmit: (request: NewProjectRequest) => void;
  readonly onCancel: () => void;
}

// Only to show where the Project goes; Rust joins the real path.
const WINDOWS_SEPARATOR = "\\";
const POSIX_SEPARATOR = "/";

function joinForDisplay(parent: string, folderName: string): string {
  const separator = parent.includes(WINDOWS_SEPARATOR)
    ? WINDOWS_SEPARATOR
    : POSIX_SEPARATOR;
  return parent.endsWith(separator)
    ? `${parent}${folderName}`
    : `${parent}${separator}${folderName}`;
}

type Field = "name" | "location" | "folderName";

// Asks for everything a new Project needs at once: its name, the place it goes in, and the
// name of its own folder there (the Project name unless the box is cleared). The place
// starts at the default one, which this dialog can also set.
export function CreateProjectDialog({
  busy,
  loadDefaultLocation,
  chooseLocation,
  onSubmit,
  onCancel,
}: CreateProjectDialogProps) {
  const messages = useMessages().workspace;
  const texts = messages.dialogs.createProject;
  const titleId = useId();
  const nameId = useId();
  const folderNameId = useId();
  const errorId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const folderNameRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState<ProjectLocation | null>(null);
  const [sameFolderName, setSameFolderName] = useState(true);
  const [folderName, setFolderName] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<{
    readonly field: Field;
    readonly message: string;
  } | null>(null);

  useEffect(() => {
    let current = true;
    void loadDefaultLocation().then((found) => {
      if (!current) return;
      // Without a default yet, the first place chosen becomes it unless the box is cleared.
      setMakeDefault(found === null);
      // A place chosen while this was loading wins.
      if (found !== null) setLocation((chosen) => chosen ?? found);
    });
    return () => {
      current = false;
    };
  }, [loadDefaultLocation]);

  const effectiveFolderName = sameFolderName ? name : folderName;

  // One folder dialog at a time: the OS would stack a second one behind the first.
  const [choosing, setChoosing] = useState(false);

  async function browse(): Promise<void> {
    setChoosing(true);
    try {
      const chosen = await chooseLocation();
      if (chosen !== null) setLocation(chosen);
    } finally {
      setChoosing(false);
    }
  }

  function fail(field: Field, message: string): void {
    setError({ field, message });
    const target = {
      name: nameRef,
      location: browseRef,
      folderName: sameFolderName ? nameRef : folderNameRef,
    }[field];
    target.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    if (!parseDisplayName(name).ok) {
      fail("name", describeInvalidName(messages, name));
      return;
    }
    if (location === null) {
      fail("location", texts.locationRequired);
      return;
    }
    if (!parseProjectFolderName(effectiveFolderName).ok) {
      fail("folderName", messages.errorKinds.invalidFolderName);
      return;
    }
    setError(null);
    onSubmit({
      name,
      locationSelectionId: location.selectionId,
      folderName: effectiveFolderName,
      makeDefaultLocation: makeDefault,
    });
  }

  const invalid = (field: Field) => error?.field === field;
  const describedBy = (field: Field) => (invalid(field) ? errorId : undefined);

  return (
    <Modal
      titleId={titleId}
      onCancel={onCancel}
      initialFocusRef={nameRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {texts.title}
      </h2>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="create-project-dialog__form"
      >
        <div className="name-dialog__field">
          <label htmlFor={nameId} className="name-dialog__label">
            {texts.nameLabel}
          </label>
          <input
            id={nameId}
            ref={nameRef}
            className="name-dialog__input"
            type="text"
            value={name}
            disabled={busy}
            autoComplete="off"
            aria-invalid={invalid("name")}
            aria-describedby={describedBy("name")}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="name-dialog__field create-project-dialog__group">
          <span className="name-dialog__label">{texts.locationLabel}</span>
          <div className="create-project-dialog__location">
            <output
              className="create-project-dialog__path"
              aria-label={texts.locationLabel}
              aria-describedby={describedBy("location")}
            >
              {location?.displayPath ?? texts.noLocation}
            </output>
            <button
              ref={browseRef}
              type="button"
              className="button"
              disabled={busy || choosing}
              onClick={() => void browse()}
            >
              {texts.browse}
            </button>
          </div>
          <label className="create-project-dialog__check">
            <input
              type="checkbox"
              checked={makeDefault}
              disabled={busy}
              onChange={(event) => setMakeDefault(event.target.checked)}
            />
            {texts.makeDefault}
          </label>
        </div>
        <div className="name-dialog__field create-project-dialog__group">
          <label htmlFor={folderNameId} className="name-dialog__label">
            {texts.folderNameLabel}
          </label>
          <input
            id={folderNameId}
            ref={folderNameRef}
            className="name-dialog__input"
            type="text"
            value={effectiveFolderName}
            disabled={busy || sameFolderName}
            autoComplete="off"
            aria-invalid={invalid("folderName")}
            aria-describedby={describedBy("folderName")}
            onChange={(event) => setFolderName(event.target.value)}
          />
          <label className="create-project-dialog__check">
            <input
              type="checkbox"
              checked={sameFolderName}
              disabled={busy}
              onChange={(event) => {
                const same = event.target.checked;
                // Starting to type from the Project name is what is usually wanted.
                if (!same && folderName === "") setFolderName(name);
                setSameFolderName(same);
              }}
            />
            {texts.sameFolderName}
          </label>
          {location === null || effectiveFolderName === "" ? null : (
            <p className="name-dialog__hint">
              {texts.destination(
                joinForDisplay(location.displayPath, effectiveFolderName),
              )}
            </p>
          )}
        </div>
        {/* An alert is announced when it appears, which is the point of showing it inline. */}
        {error === null ? null : (
          <p id={errorId} role="alert" className="name-dialog__error">
            {error.message}
          </p>
        )}
        <div className="modal__actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onCancel}
          >
            {messages.dialogs.cancel}
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={busy}
          >
            {texts.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
