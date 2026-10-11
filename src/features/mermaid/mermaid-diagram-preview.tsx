import type { ThemeState } from "../../application/theme/theme-controller";
import { MERMAID_PREVIEW_DEBOUNCE_MS } from "../../config/mermaid-preview-config";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./mermaid-diagram-preview.css";
import { useMermaidRenderer } from "./mermaid-renderer-context";
import { useMermaidPreview } from "./use-mermaid-preview";

export interface MermaidDiagramPreviewProps {
  readonly source: string;
  readonly shortId: string;
  // The editor preview waits for typing to pause; the normal view draws at once.
  readonly debounced: boolean;
  // The hint to double-click is pointless while the editor is already open.
  readonly showEditHint: boolean;
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
}: MermaidDiagramPreviewProps) {
  const messages = useMessages().mermaid;
  const renderer = useMermaidRenderer();
  const { themeController } = useWorkspaceServices();
  const themeKey = useStoreSelector(themeController.store, selectResolvedTheme);
  const { status, url, errorMessage } = useMermaidPreview({
    source,
    debounceMs: debounced ? MERMAID_PREVIEW_DEBOUNCE_MS : NO_DEBOUNCE_MS,
    renderer,
    themeKey,
  });
  const failed = status === "error";

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled region over a div is intended; <section> would not take the dynamic label as clearly.
    <div
      role="region"
      aria-label={messages.previewLabel(shortId)}
      className="mermaid-preview"
    >
      {url !== null && (
        <img
          className={
            failed
              ? "mermaid-preview__image mermaid-preview__image--stale"
              : "mermaid-preview__image"
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
    </div>
  );
}
