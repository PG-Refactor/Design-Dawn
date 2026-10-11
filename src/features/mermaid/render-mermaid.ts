// The only module that imports "mermaid" (docs/architecture.md §15.4). The library is
// loaded on first use, so it stays out of the main bundle and out of start-up.

import { MERMAID_ERROR_MESSAGE_MAX_LENGTH } from "../../config/mermaid-preview-config";
import {
  buildMermaidConfig,
  type MermaidInitializeConfig,
} from "./mermaid-config";
import type {
  MermaidRenderer,
  MermaidThemeValues,
  RenderOutcome,
} from "./mermaid-renderer-types";

// The part of the library this module uses; the real module satisfies it, a test can
// supply a fake.
export interface MermaidApi {
  initialize(config: MermaidInitializeConfig): void;
  render(id: string, source: string): Promise<{ readonly svg: string }>;
}

export type MermaidLoader = () => Promise<MermaidApi>;

const RENDER_ID_PREFIX = "dawn-mermaid-";

// Mermaid builds a wrapper element in document.body while it renders and removes it itself
// on the paths it expects. The ids are `d<id>` (wrapper) and `i<id>` (sandbox iframe, not
// used at the strict security level); a failure on a path it does not expect would leave
// them behind, so they are removed after every failure.
const TEMPORARY_ELEMENT_ID_PREFIXES = ["d", "i"] as const;

const TRUNCATION_MARK = "…";

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MERMAID_ERROR_MESSAGE_MAX_LENGTH
    ? `${text.slice(0, MERMAID_ERROR_MESSAGE_MAX_LENGTH)}${TRUNCATION_MARK}`
    : text;
}

function removeTemporaryElements(renderId: string): void {
  if (typeof document === "undefined") return;
  for (const prefix of TEMPORARY_ELEMENT_ID_PREFIXES) {
    document.getElementById(`${prefix}${renderId}`)?.remove();
  }
}

export function createMermaidRenderer(load: MermaidLoader): MermaidRenderer {
  let loading: Promise<MermaidApi> | null = null;
  let initializedWith: string | null = null;
  let renderCounter = 0;
  // Mermaid keeps its configuration in module-global state, so two renders at once could
  // see each other's settings. Calls run strictly one after another.
  let queue: Promise<unknown> = Promise.resolve();

  function loadOnce(): Promise<MermaidApi> {
    if (loading === null) {
      const attempt = load();
      // A failed load is not cached, so a later render can try again.
      attempt.catch(() => {
        if (loading === attempt) loading = null;
      });
      loading = attempt;
    }
    return loading;
  }

  async function renderNow(
    source: string,
    theme: MermaidThemeValues,
  ): Promise<RenderOutcome> {
    renderCounter += 1;
    const renderId = `${RENDER_ID_PREFIX}${renderCounter}`;
    try {
      const mermaid = await loadOnce();
      const config = buildMermaidConfig(theme);
      const configKey = JSON.stringify(config);
      // Re-initialising resets Mermaid's cached state, so it only happens when the theme
      // values changed.
      if (configKey !== initializedWith) {
        mermaid.initialize(config);
        initializedWith = configKey;
      }
      const { svg } = await mermaid.render(renderId, source);
      return { ok: true, svg };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    } finally {
      // On success Mermaid has removed its own wrapper already; this is a no-op then.
      removeTemporaryElements(renderId);
    }
  }

  return {
    render(source, theme) {
      const result = queue.then(() => renderNow(source, theme));
      queue = result;
      return result;
    },
  };
}

// `renderNow` never rejects, so the queue never needs a catch.
export const mermaidRenderer: MermaidRenderer = createMermaidRenderer(
  async () => (await import("mermaid")).default,
);
