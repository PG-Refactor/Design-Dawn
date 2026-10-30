import type {
  DiagramRenderCheck,
  DiagramRenderCheckOutcome,
} from "../../application/diagram/diagram-render-check";
import type {
  MermaidRenderer,
  MermaidThemeValues,
} from "./mermaid-renderer-types";
import { sanitizeSvg } from "./sanitize-svg";

const NO_THEME_VALUES: MermaidThemeValues = {};

// The render gate of the GUI editor: the candidate must go through the same two stages the
// preview uses (the renderer, then the SVG sanitiser), so "it draws" means "the block will
// show it". It is not a new rendering path: the renderer's serial queue is shared with the
// preview. The theme only changes colours, never whether a diagram draws, so the default
// is enough.
export function createDiagramRenderCheck(
  renderer: MermaidRenderer,
  theme: MermaidThemeValues = NO_THEME_VALUES,
): DiagramRenderCheck {
  return async (source): Promise<DiagramRenderCheckOutcome> => {
    const outcome = await renderer.render(source, theme);
    if (!outcome.ok) return { ok: false, message: outcome.message };
    try {
      sanitizeSvg(outcome.svg);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return { ok: true };
  };
}
