// The Markdown pipeline:
//   source -> markdown-it -> HTML string -> DOMPurify -> SanitizedHtml -> React
// Stage one narrows what markdown-it may produce; stage two (`sanitizeHtml`) is mandatory
// and does not rely on stage one.

import MarkdownIt from "markdown-it";
import { LINK_URL_PATTERN, MARKDOWN_CLASS_NAMES } from "./markdown-config";
import { type SanitizedHtml, sanitizeHtml } from "./sanitize-html";

function createMarkdownRenderer() {
  const renderer = new MarkdownIt({
    // Raw HTML in the source is escaped and shown as text.
    html: false,
    // Bare URLs stay text; only explicit link syntax makes a link.
    linkify: false,
    typographer: false,
  });
  // Replaces markdown-it's deny list with an allow list. A rejected destination makes
  // markdown-it print the source text of the link instead of an anchor.
  renderer.validateLink = (url) => LINK_URL_PATTERN.test(url.trim());
  // Images are never loaded (no network access from a note, no file access from a
  // path): the alt text is shown instead.
  renderer.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token === undefined) return "";
    const altText = self.renderInlineAsText(token.children ?? [], options, env);
    return `<span class="${MARKDOWN_CLASS_NAMES.imageAlt}">${renderer.utils.escapeHtml(altText)}</span>`;
  };
  return renderer;
}

const markdownRenderer = createMarkdownRenderer();

// Unsanitised HTML: exposed for tests of stage one only; a plain string cannot be handed to
// `MarkdownPreview`.
export function renderMarkdownToHtml(source: string): string {
  return markdownRenderer.render(source);
}

export function renderMarkdown(source: string): SanitizedHtml {
  return sanitizeHtml(renderMarkdownToHtml(source));
}
