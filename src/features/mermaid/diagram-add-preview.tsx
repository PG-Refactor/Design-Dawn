import type { ThemeState } from "../../application/theme/theme-controller";
import { MERMAID_PREVIEW_DEBOUNCE_MS } from "../../config/mermaid-preview-config";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { useMermaidRenderer } from "./mermaid-renderer-context";
import { useMermaidPreview } from "./use-mermaid-preview";
import "./mermaid-diagram-preview.css";

const selectResolvedTheme = (state: ThemeState) => state.resolvedTheme;

// The diagram as it would be after the add the dialog describes (the current one while
// nothing is described yet), drawn like the block's own preview but without its menus.
export function DiagramAddPreview({
  source,
  refusal,
}: {
  readonly source: string;
  // Why the described add cannot be made; the current diagram is shown then.
  readonly refusal: string | null;
}) {
  const messages = useMessages().mermaid;
  const renderer = useMermaidRenderer();
  const { themeController } = useWorkspaceServices();
  const themeKey = useStoreSelector(themeController.store, selectResolvedTheme);
  const { status, url, errorMessage } = useMermaidPreview({
    source,
    debounceMs: MERMAID_PREVIEW_DEBOUNCE_MS,
    renderer,
    themeKey,
  });
  return (
    <figure className="diagram-add-dialog__preview">
      <figcaption className="diagram-add-dialog__preview-heading">
        {messages.gui.addPreviewHeading}
      </figcaption>
      <div className="mermaid-preview diagram-add-dialog__preview-image">
        {url !== null && (
          <img
            className={
              status === "error" || refusal !== null
                ? "mermaid-preview__image mermaid-preview__image--stale"
                : "mermaid-preview__image"
            }
            src={url}
            alt={messages.gui.addPreviewAlt}
            draggable={false}
          />
        )}
        {status === "rendering" && url === null && (
          <p className="mermaid-preview__message">{messages.rendering}</p>
        )}
      </div>
      {refusal === null && status !== "error" ? null : (
        <p role="status" className="diagram-add-dialog__preview-note">
          {refusal ?? errorMessage}
        </p>
      )}
    </figure>
  );
}
