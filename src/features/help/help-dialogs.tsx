import { useEffect, useId, useRef, useState } from "react";
import appIconUrl from "../../../src-tauri/icons/128x128@2x.png";
import { APP_CONFIG } from "../../config/app-config";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import {
  type HelpTextKind,
  type HelpTextLoader,
  loadHelpText,
} from "./help-texts";
import "./help-dialogs.css";

export type HelpDialogKind = "about" | HelpTextKind;

type TextState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly text: string }
  | { readonly status: "failed" };

function AboutDialog({
  onShow,
  onClose,
}: {
  readonly onShow: (kind: HelpTextKind) => void;
  readonly onClose: () => void;
}) {
  const texts = useMessages().workspace.help;
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={onClose}
      initialFocusRef={closeRef}
    >
      <div className="help-about__header">
        {/* The same image as the installed application icon; decorative next to the name. */}
        <img className="help-about__icon" src={appIconUrl} alt="" />
        <h2 id={titleId} className="modal__title help-about__title">
          {APP_CONFIG.displayName}
        </h2>
      </div>
      <div className="modal__body">
        <p id={descriptionId}>{texts.description}</p>
        <dl className="help-about__facts">
          <dt>{texts.versionLabel}</dt>
          <dd>{APP_CONFIG.version}</dd>
          <dt>{texts.licenseLabel}</dt>
          <dd>{APP_CONFIG.licenseName}</dd>
        </dl>
      </div>
      <div className="modal__actions help-about__actions">
        <button
          type="button"
          className="button"
          onClick={() => onShow("license")}
        >
          {texts.showLicense}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onShow("thirdPartyLicenses")}
        >
          {texts.showThirdPartyLicenses}
        </button>
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

function TextDialog({
  kind,
  title,
  loadText,
  onClose,
}: {
  readonly kind: HelpTextKind;
  readonly title: string;
  readonly loadText: HelpTextLoader;
  readonly onClose: () => void;
}) {
  const texts = useMessages().workspace.help;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<TextState>({ status: "loading" });

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    loadText(kind).then(
      (text) => {
        if (current) setState({ status: "loaded", text });
      },
      () => {
        if (current) setState({ status: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [kind, loadText]);

  return (
    <Modal titleId={titleId} onCancel={onClose} initialFocusRef={closeRef} wide>
      <h2 id={titleId} className="modal__title">
        {title}
      </h2>
      {state.status === "loaded" ? (
        // A focusable region so the long text can be scrolled with the keyboard.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
        <section className="help-text" tabIndex={0} aria-labelledby={titleId}>
          <pre className="help-text__content">{state.text}</pre>
        </section>
      ) : (
        <p className="modal__body" role="status">
          {state.status === "loading" ? texts.loading : texts.loadFailed}
        </p>
      )}
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

// The dialogs of the Help menu. They only show information, so their state is local UI
// state of the top bar rather than part of the workspace dialog state.
export function HelpDialogs({
  dialog,
  onChange,
  loadText = loadHelpText,
}: {
  readonly dialog: HelpDialogKind | null;
  readonly onChange: (dialog: HelpDialogKind | null) => void;
  readonly loadText?: HelpTextLoader;
}) {
  const topBar = useMessages().workspace.topBar;
  const close = () => onChange(null);
  switch (dialog) {
    case null:
      return null;
    case "about":
      return <AboutDialog onShow={onChange} onClose={close} />;
    case "license":
    case "thirdPartyLicenses":
      return (
        <TextDialog
          key={dialog}
          kind={dialog}
          title={
            dialog === "license" ? topBar.license : topBar.thirdPartyLicenses
          }
          loadText={loadText}
          onClose={close}
        />
      );
  }
}
