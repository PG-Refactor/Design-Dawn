import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { ThemeState } from "../../application/theme/theme-controller";
import { MERMAID_PREVIEW_DEBOUNCE_MS } from "../../config/mermaid-preview-config";
import type { BlockDisplay } from "../../domain/block/content-scale";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { fittedPicturePercent, zoomOf } from "../canvas/fit-content-scale";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./mermaid-diagram-preview.css";
import { useContextMenu } from "../../shared/menu/context-menu";
import { useDiagramInteraction } from "./diagram-interaction";
import { type DiagramHit, shapeAt } from "./diagram-shapes";
import { useMermaidRenderer } from "./mermaid-renderer-context";
import { useMermaidPreview } from "./use-mermaid-preview";

export interface MermaidDiagramPreviewProps {
  readonly source: string;
  readonly shortId: string;
  // The editor preview waits for typing to pause; the normal view draws at once.
  readonly debounced: boolean;
  // The hint to double-click is pointless while the editor is already open.
  readonly showEditHint: boolean;
  // Told once per source that fails to draw (the normal view reports it as a notification).
  readonly onRenderFailed?: (message: string) => void;
  // How the block shows the diagram (the normal view). Absent (the editor's picture): it
  // is shrunk to the room it has, never enlarged.
  readonly display?: BlockDisplay;
  readonly onFittedScale?: (percent: number) => void;
}

interface NaturalSize {
  readonly width: number;
  readonly height: number;
}

const selectResolvedTheme = (state: ThemeState) => state.resolvedTheme;
const NO_DEBOUNCE_MS = 0;

// The diagram of a Mermaid block as an image. The SVG is only ever an <img> source (an
// object URL of sanitised SVG), never markup in the page; error text is a React text node.
export function MermaidDiagramPreview({
  source,
  shortId,
  debounced,
  showEditHint,
  onRenderFailed,
  display,
  onFittedScale,
}: MermaidDiagramPreviewProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  // The picture's own size (the sanitiser writes the diagram's size on the SVG).
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const messages = useMessages().mermaid;
  const renderer = useMermaidRenderer();
  const { themeController } = useWorkspaceServices();
  const themeKey = useStoreSelector(themeController.store, selectResolvedTheme);
  const interaction = useDiagramInteraction();
  const contextMenu = useContextMenu();
  const { status, url, errorMessage, shapes } = useMermaidPreview({
    source,
    debounceMs: debounced ? MERMAID_PREVIEW_DEBOUNCE_MS : NO_DEBOUNCE_MS,
    renderer,
    themeKey,
  });
  const failed = status === "error";
  useEffect(() => {
    if (failed) onRenderFailed?.(errorMessage ?? "");
  }, [failed, errorMessage, onRenderFailed]);

  const fitting = display?.autoFit === true;
  // What a fitted diagram is shown at, for the display size buttons: again whenever the
  // block (and so the picture) changes size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onFittedScale is a fresh function on each render of the block; telling it again changes nothing.
  useEffect(() => {
    const image = imageRef.current;
    if (!fitting || image === null || natural === null) return undefined;
    const report = () => {
      const percent = fittedPicturePercent(natural, {
        width: image.clientWidth,
        height: image.clientHeight,
      });
      if (percent !== null) onFittedScale?.(percent);
    };
    report();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(image);
    return () => observer.disconnect();
  }, [fitting, natural]);

  const imageClass = [
    "mermaid-preview__image",
    display === undefined
      ? ""
      : fitting
        ? "mermaid-preview__image--fit"
        : "mermaid-preview__image--scaled",
    failed ? "mermaid-preview__image--stale" : "",
  ]
    .filter((name) => name !== "")
    .join(" ");
  const imageStyle =
    display === undefined || fitting || natural === null
      ? undefined
      : {
          width: natural.width * zoomOf(display.scalePercent),
          height: natural.height * zoomOf(display.scalePercent),
        };

  // The shape under the pointer, when the event is on the picture.
  function hitOf(event: MouseEvent<HTMLElement>): DiagramHit | null {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || shapes == null) return null;
    const box = image.getBoundingClientRect();
    return shapeAt(
      shapes,
      { x: event.clientX - box.left, y: event.clientY - box.top },
      { width: box.width, height: box.height },
    );
  }

  // Only while the GUI editor is beside the picture (it registers what it offers).
  function onContextMenu(event: MouseEvent<HTMLDivElement>): void {
    const handler = interaction?.current() ?? null;
    if (handler === null) return;
    const entries = handler.entriesFor(hitOf(event));
    if (entries.length === 0) return;
    contextMenu.openFromEvent(event, messages.gui.diagramMenuLabel, entries);
  }

  function onClick(event: MouseEvent<HTMLDivElement>): void {
    const handler = interaction?.current() ?? null;
    const hit = handler === null ? null : hitOf(event);
    if (handler !== null && hit !== null) handler.pick(hit);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled region over a div is intended; <section> would not take the dynamic label as clearly.
    // biome-ignore lint/a11y/useKeyWithClickEvents: clicking a shape is a shortcut for choosing it in the editor's lists, which the keyboard reaches.
    <div
      role="region"
      aria-label={messages.previewLabel(shortId)}
      className="mermaid-preview"
      onContextMenu={onContextMenu}
      onClick={onClick}
    >
      {url !== null && (
        <img
          ref={imageRef}
          className={imageClass}
          style={imageStyle}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          src={url}
          alt={messages.diagramAlt(shortId)}
          draggable={false}
        />
      )}
      {status === "empty" && (
        <p className="mermaid-preview__message">{messages.empty}</p>
      )}
      {status === "rendering" && url === null && (
        <p className="mermaid-preview__message">{messages.rendering}</p>
      )}
      {failed && (
        <div
          role="alert"
          className={
            url === null
              ? "mermaid-preview__error"
              : "mermaid-preview__error mermaid-preview__error--over-image"
          }
        >
          {url === null && (
            <p className="mermaid-preview__error-title">
              {messages.renderFailed}
            </p>
          )}
          <p className="mermaid-preview__error-label">
            {messages.errorDetails}
          </p>
          <pre className="mermaid-preview__error-detail">{errorMessage}</pre>
          {url === null && showEditHint && (
            <p className="mermaid-preview__hint">{messages.editHint}</p>
          )}
        </div>
      )}
      {contextMenu.element}
    </div>
  );
}
