import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useRef } from "react";
import type { SanitizedHtml } from "./sanitize-html";
import "./markdown-preview.css";

export interface MarkdownPreviewProps {
  // Sanitised HTML only: the type is what keeps unsanitised strings out of the one
  // `dangerouslySetInnerHTML` of the application.
  readonly html: SanitizedHtml;
  readonly label: string;
  // Edit mode scrolls the content; in the normal state the block clips it.
  readonly scrollable?: boolean;
}

const ENTER_KEY = "Enter";

function anchorOf(target: EventTarget): Element | null {
  return target instanceof Element ? target.closest("a") : null;
}

// Links are display-only: following one would navigate the whole application window away
// from the document. Clicks (mouse, keyboard activation, middle click) are cancelled; no
// `target` is ever added.
function cancelLinkActivation(event: MouseEvent | KeyboardEvent): void {
  if (anchorOf(event.target) !== null) event.preventDefault();
}

export function MarkdownPreview({
  html,
  label,
  scrollable = false,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // A link that does nothing must not be a tab stop inside the canvas; it stays
  // clickable (clicks only focus it) but Tab skips it. Set after every content change,
  // because the HTML is replaced as a whole.
  // biome-ignore lint/correctness/useExhaustiveDependencies: html is the trigger; the effect reads the DOM it produced.
  useEffect(() => {
    for (const anchor of containerRef.current?.querySelectorAll("a") ?? []) {
      anchor.tabIndex = -1;
    }
  }, [html]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled region over a div is intended; <section> would not take the dynamic label as clearly.
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      className={
        scrollable
          ? "markdown-preview markdown-preview--scrollable"
          : "markdown-preview"
      }
      onClick={cancelLinkActivation}
      onAuxClick={cancelLinkActivation}
      onKeyDown={(event) => {
        if (event.key === ENTER_KEY) cancelLinkActivation(event);
      }}
      // The only dangerouslySetInnerHTML of the application (checked by a guard test);
      // `html` is SanitizedHtml, i.e. it came out of DOMPurify.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify, see above.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
