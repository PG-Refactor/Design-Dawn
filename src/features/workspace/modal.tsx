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
  readonly inert: string | null;
  readonly ariaHidden: string | null;
}

// The open dialogs, newest last. Only the newest is usable; everything else in the body,
// including an older dialog, is hidden from assistive technology and from focus. Dialogs
// can close in any order (a close request can open a question over another dialog, and the
// lower one may close first), so the state is recomputed from this stack instead of each
// dialog restoring what it saw when it opened.
const openHosts: Element[] = [];
// What each hidden element carried before any dialog touched it.
const originals = new Map<Element, SavedAttributes>();

function restore(element: Element): void {
  const saved = originals.get(element);
  if (saved === undefined) return;
  originals.delete(element);
  if (saved.inert === null) element.removeAttribute(INERT_ATTRIBUTE);
  else element.setAttribute(INERT_ATTRIBUTE, saved.inert);
  if (saved.ariaHidden === null) element.removeAttribute(ARIA_HIDDEN_ATTRIBUTE);
  else element.setAttribute(ARIA_HIDDEN_ATTRIBUTE, saved.ariaHidden);
}

function applyModalStack(): void {
  const top = openHosts[openHosts.length - 1];
  if (top === undefined) {
    for (const element of [...originals.keys()]) restore(element);
    return;
  }
  for (const element of [...document.body.children]) {
    if (element === top) {
      restore(element);
      continue;
    }
    if (!originals.has(element)) {
      originals.set(element, {
        inert: element.getAttribute(INERT_ATTRIBUTE),
        ariaHidden: element.getAttribute(ARIA_HIDDEN_ATTRIBUTE),
      });
    }
    element.setAttribute(INERT_ATTRIBUTE, "");
    element.setAttribute(ARIA_HIDDEN_ATTRIBUTE, "true");
  }
}

function hideSiblings(host: Element): () => void {
  openHosts.push(host);
  applyModalStack();
  return () => {
    const index = openHosts.indexOf(host);
    if (index >= 0) openHosts.splice(index, 1);
    applyModalStack();
    // The host leaves the body right after; what was saved for it is of no further use.
    originals.delete(host);
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
  // For long read-only texts (license texts) that need the room.
  readonly wide?: boolean;
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
  wide = false,
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
        className={wide ? "modal modal--wide" : "modal"}
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
