import { useEffect, useRef, useState } from "react";
import { MERMAID_IMMEDIATE_RENDER_DELAY_MS } from "../../config/mermaid-preview-config";
import { type DiagramShapes, readDiagramShapes } from "./diagram-shapes";
import type { MermaidRenderer } from "./mermaid-renderer-types";
import { resolveMermaidTheme } from "./resolve-mermaid-theme";
import { type SanitizedSvg, sanitizeSvg } from "./sanitize-svg";
import {
  createSvgObjectUrl,
  revokeSvgObjectUrl,
  type SanitizedSvgUrl,
} from "./svg-object-url";

export type MermaidPreviewStatus = "empty" | "rendering" | "ready" | "error";

export interface MermaidPreview {
  readonly status: MermaidPreviewStatus;
  // The last diagram that rendered successfully; kept while a newer source fails.
  readonly url: SanitizedSvgUrl | null;
  readonly errorMessage: string | null;
  // Where the shapes of that diagram are (for clicks on the picture), when readable.
  readonly shapes?: DiagramShapes | null;
}

export interface UseMermaidPreviewInput {
  readonly source: string;
  // Quiet time after the source changed before drawing. The first draw and a theme change
  // do not wait.
  readonly debounceMs: number;
  readonly renderer: MermaidRenderer;
  // Changes when the resolved theme changes, to draw again with the new colours.
  readonly themeKey: string;
}

function isBlank(source: string): boolean {
  return source.trim() === "";
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeToUrl(svg: string): {
  readonly url: SanitizedSvgUrl;
  readonly shapes: DiagramShapes | null;
} {
  const sanitized: SanitizedSvg = sanitizeSvg(svg);
  return {
    url: createSvgObjectUrl(sanitized),
    shapes: readDiagramShapes(sanitized),
  };
}

// Draws `source` and keeps the result as an object URL for an <img>. The URL is owned by
// this hook: it is revoked when a newer diagram replaces it, when the source becomes empty
// and when the component goes away, so no blob outlives the block that showed it.
export function useMermaidPreview({
  source,
  debounceMs,
  renderer,
  themeKey,
}: UseMermaidPreviewInput): MermaidPreview {
  const [preview, setPreview] = useState<MermaidPreview>({
    status: isBlank(source) ? "empty" : "rendering",
    url: null,
    errorMessage: null,
  });
  // Only the newest request may change the state; results of older ones are dropped
  // before an URL is made for them.
  const requestRef = useRef(0);
  const currentUrlRef = useRef<SanitizedSvgUrl | null>(null);
  const hasDrawnRef = useRef(false);
  const lastThemeKeyRef = useRef(themeKey);

  function replaceUrl(next: SanitizedSvgUrl | null): void {
    if (currentUrlRef.current !== null) {
      revokeSvgObjectUrl(currentUrlRef.current);
    }
    currentUrlRef.current = next;
  }

  useEffect(
    () => () => {
      if (currentUrlRef.current !== null) {
        revokeSvgObjectUrl(currentUrlRef.current);
        currentUrlRef.current = null;
      }
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: replaceUrl only touches refs and is recreated on every render; the effect must run on the inputs alone.
  useEffect(() => {
    requestRef.current += 1;
    const requestId = requestRef.current;

    if (isBlank(source)) {
      replaceUrl(null);
      setPreview({ status: "empty", url: null, errorMessage: null });
      return () => {
        requestRef.current += 1;
      };
    }

    const themeChanged = lastThemeKeyRef.current !== themeKey;
    lastThemeKeyRef.current = themeKey;
    const delay =
      hasDrawnRef.current && !themeChanged
        ? debounceMs
        : MERMAID_IMMEDIATE_RENDER_DELAY_MS;

    async function draw(): Promise<void> {
      setPreview((previous) =>
        previous.status === "empty"
          ? { ...previous, status: "rendering" }
          : previous,
      );
      let message: string | null = null;
      let svg: string | null = null;
      try {
        const outcome = await renderer.render(
          source,
          resolveMermaidTheme(document.documentElement),
        );
        if (outcome.ok) svg = outcome.svg;
        else message = outcome.message;
      } catch (error) {
        // The renderer promises not to reject; this keeps a broken one from escaping.
        message = describeFailure(error);
      }
      if (requestRef.current !== requestId) return;
      // Counted once a result is applied, so a draw that was discarded (StrictMode's
      // second effect run, an unmount) does not make the real first draw wait.
      hasDrawnRef.current = true;

      if (svg !== null) {
        try {
          const { url, shapes } = sanitizeToUrl(svg);
          replaceUrl(url);
          setPreview({ status: "ready", url, errorMessage: null, shapes });
          return;
        } catch (error) {
          message = describeFailure(error);
        }
      }
      // The last good diagram stays; only the message changes.
      setPreview((previous) => ({
        status: "error",
        url: previous.url,
        errorMessage: message ?? "",
      }));
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (delay === MERMAID_IMMEDIATE_RENDER_DELAY_MS) {
      void draw();
    } else {
      timer = setTimeout(() => void draw(), delay);
    }
    return () => {
      if (timer !== null) clearTimeout(timer);
      requestRef.current += 1;
    };
  }, [source, debounceMs, renderer, themeKey]);

  return preview;
}
