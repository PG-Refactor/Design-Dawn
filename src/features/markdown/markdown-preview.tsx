import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { largestFittingPercent, zoomOf } from "../canvas/fit-content-scale";
import type { SanitizedHtml } from "./sanitize-html";
import "./markdown-preview.css";

export interface MarkdownPreviewProps {
  // Sanitised HTML only: the type is what keeps unsanitised strings out of the one
  // `dangerouslySetInnerHTML` of the application.
  readonly html: SanitizedHtml;
  readonly label: string;
  // Edit mode scrolls the content; in the normal state the block clips it.
  readonly scrollable?: boolean;
  // The size the content is shown at, in percent (absent: as written).
  readonly scalePercent?: number;
  // Show it at the largest size at which all of it is inside (`scalePercent` is unused).
  readonly autoFit?: boolean;
  readonly onFittedScale?: (percent: number) => void;
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
  scalePercent,
  autoFit = false,
  onFittedScale,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fittedPercent, setFittedPercent] = useState<number | null>(null);
  const [roomKey, setRoomKey] = useState(0);

  // A link that does nothing must not be a tab stop inside the canvas; it stays
  // clickable (clicks only focus it) but Tab skips it. Set after every content change,
  // because the HTML is replaced as a whole.
  // biome-ignore lint/correctness/useExhaustiveDependencies: html is the trigger; the effect reads the DOM it produced.
  useEffect(() => {
    for (const anchor of containerRef.current?.querySelectorAll("a") ?? []) {
      anchor.tabIndex = -1;
    }
  }, [html]);

  // Fitting follows the block's size and late pictures (an image's height is known only
  // once it has loaded).
  useEffect(() => {
    const container = containerRef.current;
    if (!autoFit || container === null) return undefined;
    const again = () => setRoomKey((key) => key + 1);
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(again) : null;
    observer?.observe(container);
    container.addEventListener("load", again, true);
    return () => {
      observer?.disconnect();
      container.removeEventListener("load", again, true);
    };
  }, [autoFit]);

  // The largest size at which all of the text is inside the block: laid out at each try
  // before painting, so only the answer is ever seen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: html and roomKey are the triggers; the effect measures the DOM.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!autoFit || container === null || content === null) {
      setFittedPercent(null);
      return;
    }
    const fits = (percent: number) => {
      content.style.zoom = String(zoomOf(percent));
      return (
        container.scrollHeight <= container.clientHeight &&
        container.scrollWidth <= container.clientWidth
      );
    };
    const percent = largestFittingPercent(fits);
    content.style.zoom = String(zoomOf(percent));
    setFittedPercent(percent);
    onFittedScale?.(percent);
  }, [autoFit, html, roomKey]);

  const shownPercent = autoFit ? fittedPercent : (scalePercent ?? null);
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
    >
      <div
        ref={contentRef}
        className="markdown-preview__content"
        style={
          shownPercent === null ? undefined : { zoom: zoomOf(shownPercent) }
        }
        // The only dangerouslySetInnerHTML of the application (checked by a guard test);
        // `html` is SanitizedHtml, i.e. it came out of DOMPurify.
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify, see above.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
