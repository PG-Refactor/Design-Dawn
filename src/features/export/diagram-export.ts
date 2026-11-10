// A Mermaid diagram as a file: rendered again in the light theme, then as SVG text or as a
// PNG drawn from that SVG. The SVG is the sanitised one the app shows (no scripts, no
// foreignObject), so drawing it onto a canvas is safe and does not taint it.

import type {
  MermaidRenderer,
  MermaidThemeValues,
} from "../mermaid/mermaid-renderer-types";
import { resolveMermaidTheme } from "../mermaid/resolve-mermaid-theme";
import { THEME_ATTRIBUTE_NAME } from "../theme/apply-theme";
import { EXPORT_CONFIG } from "./export-config";

const SVG_MIME_TYPE = "image/svg+xml";
const PNG_MIME_TYPE = "image/png";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';
const VIEW_BOX_ATTRIBUTE = "viewBox";
const VIEW_BOX_SEPARATOR = /[\s,]+/;
const SURFACE_TOKEN = "--color-surface";

// The light theme's values, read by switching the root's theme for the length of one
// synchronous style read (no frame is drawn in between, so nothing flickers).
export function exportThemeValues(root: HTMLElement): {
  readonly theme: MermaidThemeValues;
  readonly background: string;
} {
  const previous = root.getAttribute(THEME_ATTRIBUTE_NAME);
  root.setAttribute(THEME_ATTRIBUTE_NAME, EXPORT_CONFIG.theme);
  try {
    return {
      theme: resolveMermaidTheme(root),
      background: getComputedStyle(root).getPropertyValue(SURFACE_TOKEN).trim(),
    };
  } finally {
    if (previous === null) root.removeAttribute(THEME_ATTRIBUTE_NAME);
    else root.setAttribute(THEME_ATTRIBUTE_NAME, previous);
  }
}

export type DiagramRender =
  | { readonly ok: true; readonly svg: string; readonly background: string }
  | { readonly ok: false; readonly message: string };

export async function renderDiagramForExport(
  renderer: MermaidRenderer,
  source: string,
): Promise<DiagramRender> {
  const { theme, background } = exportThemeValues(document.documentElement);
  const rendered = await renderer.render(source, theme);
  return rendered.ok
    ? { ok: true, svg: rendered.svg, background }
    : { ok: false, message: rendered.message };
}

// The width and height the viewBox gives, which become the SVG's own size (Mermaid writes
// `width="100%"`, which an image file would not know how to size).
function viewBoxSize(
  svg: SVGSVGElement,
): { width: number; height: number } | null {
  const parts = (svg.getAttribute(VIEW_BOX_ATTRIBUTE) ?? "")
    .trim()
    .split(VIEW_BOX_SEPARATOR)
    .map(Number);
  const [, , width, height] = parts;
  return width !== undefined &&
    height !== undefined &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : null;
}

// The SVG as a standalone file: an XML declaration and its size from the viewBox.
export function svgFileText(svg: string): {
  readonly text: string;
  readonly width: number;
  readonly height: number;
} | null {
  const parsed = new DOMParser().parseFromString(svg, SVG_MIME_TYPE);
  const root = parsed.documentElement;
  if (!(root instanceof SVGSVGElement)) return null;
  const size = viewBoxSize(root);
  if (size === null) return null;
  root.setAttribute("width", String(size.width));
  root.setAttribute("height", String(size.height));
  root.removeAttribute("style");
  return {
    text: `${XML_DECLARATION}${new XMLSerializer().serializeToString(root)}`,
    ...size,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the diagram could not be drawn"));
    image.src = url;
  });
}

// The SVG drawn onto a canvas at EXPORT_CONFIG.pngScale over the theme's background.
export async function svgToPng(
  file: {
    readonly text: string;
    readonly width: number;
    readonly height: number;
  },
  background: string,
): Promise<Uint8Array> {
  const url = URL.createObjectURL(
    new Blob([file.text], { type: SVG_MIME_TYPE }),
  );
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(file.width * EXPORT_CONFIG.pngScale);
    canvas.height = Math.ceil(file.height * EXPORT_CONFIG.pngScale);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2D canvas");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, PNG_MIME_TYPE),
    );
    if (blob === null) throw new Error("the PNG could not be made");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
