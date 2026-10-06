import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { focusableElements, restoreFocus } from "./focus-utils";
import "./modal.css";

const KEY_ESCAPE = "Escape";
const KEY_TAB = "Tab";
const INERT_ATTRIBUTE = "inert";
const ARIA_HIDDEN_ATTRIBUTE = "aria-hidden";

interface SavedAttributes {
  readonly element: Element;
  readonly inert: string | null;
  readonly ariaHidden: string | null;
}

// Hides everything outside the dialog from assistive technology and from focus. The
// previous attribute values are restored exactly when the dialog closes.
function hideSiblings(host: Element): () => void {
  const saved: SavedAttributes[] = [...document.body.children]
    .filter((element) => element !== host)
    .map((element) => ({
      element,
      inert: element.getAttribute(INERT_ATTRIBUTE),
      ariaHidden: element.getAttribute(ARIA_HIDDEN_ATTRIBUTE),
    }));
  for (const { element } of saved) {
    element.setAttribute(INERT_ATTRIBUTE, "");
    element.setAttribute(ARIA_HIDDEN_ATTRIBUTE, "true");
  }
  return () => {
    for (const { element, inert, ariaHidden } of saved) {
      if (inert === null) element.removeAttribute(INERT_ATTRIBUTE);
      else element.setAttribute(INERT_ATTRIBUTE, inert);
      if (ariaHidden === null) element.removeAttribute(ARIA_HIDDEN_ATTRIBUTE);
      else element.setAttribute(ARIA_HIDDEN_ATTRIBUTE, ariaHidden);
    }
  };
}

export interface ModalProps {
  readonly titleId: string;
  readonly descriptionId?: string;
  readonly onCancel: () => void;
  // The element that gets focus when the dialog opens; the first focusable one otherwise.
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  // While true Escape does nothing (an operation is running).
  readonly busy?: boolean;
  readonly children: ReactNode;
}

// Accessible modal: labelled dialog, focus moves in and is trapped, Escape cancels, the
// background is inert, and focus returns to where it was when the dialog closes.
export function Modal({
  titleId,
  descriptionId,
  onCancel,
  initialFocusRef,
  busy = false,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const portalHost = useRef<HTMLDivElement | null>(null);
  if (portalHost.current === null) {
    portalHost.current = document.createElement("div");
  }

  useEffect(() => {
    const host = portalHost.current;
    if (host === null) return;
    const previouslyFocused = document.activeElement;
    document.body.appendChild(host);
    const showSiblings = hideSiblings(host);
    const dialog = dialogRef.current;
    const initial =
      initialFocusRef?.current ??
      (dialog === null ? null : (focusableElements(dialog)[0] ?? dialog));
    initial?.focus();
    return () => {
      showSiblings();
      host.remove();
      restoreFocus(previouslyFocused);
    };
  }, [initialFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === KEY_ESCAPE) {
      event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== KEY_TAB) return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusable = focusableElements(dialog);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      {/* The keydown handler is the focus trap; the dialog role is not a widget. */}
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>,
    portalHost.current,
  );
}
