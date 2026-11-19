// How tall a Markdown block must be to show all of a text: the text is drawn once, out of
// sight, with the preview's own styles at the block's width, and measured. Used where a
// size has to be chosen before the block exists (a table imported from a spreadsheet).

import { renderMarkdown } from "./render-markdown";

const PREVIEW_CLASS = "markdown-preview";
const HTML_MIME_TYPE = "text/html";
// The canvas world pins the text size and spacing of block content (whatever the UI text
// size): measured inside one, the text is as large as on the canvas.
const WORLD_CLASS = "canvas__world";
const MEASURE_STYLE: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  visibility: "hidden",
  pointerEvents: "none",
  left: "0",
  top: "0",
  height: "auto",
  overflow: "visible",
};

// Null where nothing can be measured (no layout, as in tests): the caller estimates.
export function measureMarkdownHeight(
  markdown: string,
  width: number,
): number | null {
  if (typeof document === "undefined") return null;
  const preview = document.createElement("div");
  preview.className = PREVIEW_CLASS;
  Object.assign(preview.style, MEASURE_STYLE, { width: `${width}px` });
  // Sanitised HTML, as the preview itself shows it, parsed in an inert document (nothing
  // runs or loads there) and moved into the measuring element.
  const parsed = new DOMParser().parseFromString(
    renderMarkdown(markdown),
    HTML_MIME_TYPE,
  );
  preview.append(
    ...[...parsed.body.childNodes].map((node) => document.adoptNode(node)),
  );
  const world = document.createElement("div");
  world.className = WORLD_CLASS;
  world.style.visibility = "hidden";
  world.appendChild(preview);
  document.body.appendChild(world);
  try {
    const height = preview.getBoundingClientRect().height;
    return height > 0 ? Math.ceil(height) : null;
  } finally {
    world.remove();
  }
}
