import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  AiAccessOverview,
  AiProjectAccess,
} from "../../application/ports/ai-access-gateway";
import { AI_ACCESS_CONFIG } from "../../config/ai-access-config";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { mcpServersJson } from "./mcp-registration";
import "./ai-access-dialog.css";

type OverviewState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly overview: AiAccessOverview }
  | { readonly status: "failed" };

type CopyState = "idle" | "copied" | "failed";

// A read-only field with a copy button. The field stays selectable, so the text can be
// copied by hand when the clipboard is not available.
function CopyField({
  label,
  value,
  multiline,
}: {
  readonly label: string;
  readonly value: string;
  readonly multiline?: boolean;
}) {
  const texts = useMessages().aiAccess;
  const fieldId = useId();
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = setTimeout(
      () => setCopyState("idle"),
      AI_ACCESS_CONFIG.copiedNoticeMs,
    );
    return () => clearTimeout(timer);
  }, [copyState]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="ai-access__copy-field">
      <label htmlFor={fieldId} className="ai-access__label">
        {label}
      </label>
      <div className="ai-access__copy-row">
        {multiline === true ? (
          <textarea
            id={fieldId}
            className="ai-access__value ai-access__value--multiline"
            value={value}
            readOnly
            rows={value.split("\n").length}
          />
        ) : (
          <input
            id={fieldId}
            className="ai-access__value"
            value={value}
            readOnly
          />
        )}
        <button type="button" className="button" onClick={() => void copy()}>
          {texts.copy}
        </button>
      </div>
      <p className="ai-access__copy-status" role="status">
        {copyState === "copied"
          ? texts.copied
          : copyState === "failed"
            ? texts.copyFailed
            : ""}
      </p>
    </div>
  );
}

function ProjectRow({
  project,
  busy,
  onAllowWrite,
  onRemove,
}: {
  readonly project: AiProjectAccess;
  readonly busy: boolean;
  readonly onAllowWrite: (allow: boolean) => void;
  readonly onRemove: () => void;
}) {
  const texts = useMessages().aiAccess;
  const name = project.name ?? texts.missingProject;
  return (
    <li className="ai-access__project">
      <div className="ai-access__project-head">
        <span className="ai-access__project-name">{name}</span>
        {project.current && (
          <span className="ai-access__badge">{texts.current}</span>
        )}
        <label className="ai-access__check">
          <input
            type="checkbox"
            checked={project.allowWrite}
            disabled={busy}
            aria-label={texts.allowWriteLabel(name)}
            onChange={(event) => onAllowWrite(event.currentTarget.checked)}
          />
          {texts.allowWrite}
        </label>
      </div>
      <div className="ai-access__project-foot">
        <span className="ai-access__project-folder">
          {project.folderDisplay}
        </span>
        <button
          type="button"
          className="button"
          disabled={busy}
          aria-label={texts.removeLabel(name)}
          onClick={onRemove}
        >
          {texts.remove}
        </button>
      </div>
    </li>
  );
}

// The AI integration screen: how to register the MCP server with an AI tool, and which
// Projects an AI may use and change. Every change is made by Rust and read back.
export function AiAccessDialog({ onClose }: { readonly onClose: () => void }) {
  const texts = useMessages().aiAccess;
  const { aiAccess } = useWorkspaceServices();
  const titleId = useId();
  const openHintId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<OverviewState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  // The last change that failed, shown until the next one.
  const [failed, setFailed] = useState<"change" | "add" | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const result = await aiAccess.overview();
    setState(
      result.ok
        ? { status: "loaded", overview: result.value }
        : { status: "failed" },
    );
  }, [aiAccess]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function change(
    run: () => Promise<{ readonly ok: boolean }>,
    failure: "change" | "add" = "change",
  ): Promise<void> {
    setBusy(true);
    setFailed(null);
    const result = await run();
    if (!result.ok) setFailed(failure);
    await reload();
    setBusy(false);
  }

  const overview = state.status === "loaded" ? state.overview : null;
  // Why "add the open Project" is unavailable, or null.
  const openProjectHint =
    overview === null
      ? null
      : overview.openProject === null
        ? texts.noOpenProject
        : overview.openProject.listed
          ? texts.openProjectListed
          : null;
  return (
    <Modal titleId={titleId} onCancel={onClose} initialFocusRef={closeRef} wide>
      <h2 id={titleId} className="modal__title">
        {texts.title}
      </h2>
      <div className="modal__body ai-access">
        {state.status === "loading" && <p>{texts.loading}</p>}
        {state.status === "failed" && <p role="alert">{texts.loadFailed}</p>}
        {overview !== null && (
          <>
            <section className="ai-access__section">
              <h3 className="ai-access__heading">{texts.registerHeading}</h3>
              <p>{texts.registerIntro}</p>
              <CopyField
                label={texts.commandLabel}
                value={overview.mcpServer.displayPath}
              />
              {!overview.mcpServer.found && (
                <p className="ai-access__warning" role="alert">
                  {texts.serverMissing}
                </p>
              )}
              <CopyField
                label={texts.jsonLabel}
                value={mcpServersJson(overview.mcpServer.displayPath)}
                multiline
              />
              <p className="ai-access__hint">{texts.registerHint}</p>
            </section>
            <section className="ai-access__section">
              <h3 className="ai-access__heading">{texts.projectsHeading}</h3>
              <p>{texts.projectsIntro}</p>
              {overview.loadIssue !== null && (
                <p className="ai-access__warning" role="alert">
                  {texts.listUnreadable}
                </p>
              )}
              {failed !== null && (
                <p className="ai-access__warning" role="alert">
                  {failed === "add" ? texts.addFailed : texts.changeFailed}
                </p>
              )}
              {overview.projects.length === 0 ? (
                <p className="ai-access__hint">{texts.projectsEmpty}</p>
              ) : (
                <ul className="ai-access__projects">
                  {overview.projects.map((project) => (
                    <ProjectRow
                      key={project.projectId}
                      project={project}
                      busy={busy}
                      onAllowWrite={(allow) =>
                        void change(() =>
                          aiAccess.setWriteAccess(project.projectId, allow),
                        )
                      }
                      onRemove={() =>
                        void change(() => aiAccess.remove(project.projectId))
                      }
                    />
                  ))}
                </ul>
              )}
              <div className="ai-access__add">
                <button
                  type="button"
                  className="button"
                  disabled={busy || openProjectHint !== null}
                  aria-describedby={
                    openProjectHint === null ? undefined : openHintId
                  }
                  onClick={() =>
                    void change(() => aiAccess.addOpenProject(), "add")
                  }
                >
                  {texts.addOpenProject}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void change(() => aiAccess.addProjectFolder(), "add")
                  }
                >
                  {texts.addProjectFolder}
                </button>
              </div>
              {openProjectHint !== null && (
                <p id={openHintId} className="ai-access__hint">
                  {openProjectHint}
                </p>
              )}
            </section>
          </>
        )}
      </div>
      <div className="modal__actions">
        <button
          ref={closeRef}
          type="button"
          className="button button--primary"
          onClick={onClose}
        >
          {texts.close}
        </button>
      </div>
    </Modal>
  );
}
