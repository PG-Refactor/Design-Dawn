// The Markdown pipeline:
//   source -> markdown-it -> HTML string -> DOMPurify -> SanitizedHtml -> React
// Stage one narrows what markdown-it may produce; stage two (`sanitizeHtml`) is mandatory
// and does not rely on stage one.

import type { StateCore, Token } from "markdown-it";
import MarkdownIt from "markdown-it";
import type { ContentPath } from "../../domain/block/content-path";
import { resolveMarkdownImagePath } from "../../domain/block/markdown-image-path";
import {
  LINK_URL_PATTERN,
  MARKDOWN_CLASS_NAMES,
  SHORT_CELL_MAX_CHARACTERS,
  TABLE_ALIGNMENTS,
  URL_SCHEME_PATTERN,
} from "./markdown-config";
import { type SanitizedHtml, sanitizeHtml } from "./sanitize-html";

// What a block needs to show its images: where its file is (relative paths are resolved
// from there) and the asset URLs of its Document. Without it images show their alt text.
export interface MarkdownImageContext {
  readonly markdownContentPath: string;
  // The URL of one asset (`assets/<file>`) of the block's Document.
  readonly urlFor: (assetContentPath: ContentPath) => string;
  // Every URL `urlFor` returns starts with it; the sanitiser drops any other image source.
  readonly urlPrefix: string;
}

// markdown-it's environment is an open record; this pipeline puts one key in it.
interface RenderEnvironment {
  [key: string | symbol]: unknown;
  readonly images?: MarkdownImageContext;
}

function isRenderEnvironment(value: unknown): value is RenderEnvironment {
  return typeof value === "object" && value !== null;
}

const IMAGE_SOURCE_ATTRIBUTE = "src";

// markdown-it types attribute values as `string | number`; destinations are strings.
function stringAttribute(token: Token, name: string): string | null {
  const value = token.attrGet(name);
  return typeof value === "string" ? value : null;
}
const LINK_TARGET_ATTRIBUTE = "href";
const STYLE_ATTRIBUTE = "style";
const CLASS_ATTRIBUTE = "class";
const ALIGNMENT_STYLE = new RegExp(
  `^text-align:(${TABLE_ALIGNMENTS.join("|")})$`,
);
const TABLE_CELL_OPEN_RULES = ["th_open", "td_open"] as const;
const WHITESPACE = /\s/;
// A line break written in a cell (`<br>`): the cell is not a single short value.
const LINE_BREAK_MARK = "<br";

// markdown-it asks one question (`validateLink`) for links and images alike. A relative
// path has to pass it so that an image can point at an asset, but a relative LINK is still
// not a link: this rule puts such a link back as the text it was written as, which is
// what a refused destination looked like before.
function restoreUnlinkableLinks(state: StateCore): void {
  for (const blockToken of state.tokens) {
    const children = blockToken.children;
    if (blockToken.type !== "inline" || children === null) continue;
    const restored: Token[] = [];
    const openLinkTargets: (string | null)[] = [];
    for (const child of children) {
      if (child.type === "link_open") {
        const target = stringAttribute(child, LINK_TARGET_ATTRIBUTE) ?? "";
        if (LINK_URL_PATTERN.test(target)) {
          openLinkTargets.push(null);
          restored.push(child);
        } else {
          openLinkTargets.push(target);
          restored.push(textToken(state, "["));
        }
        continue;
      }
      if (child.type === "link_close") {
        const target = openLinkTargets.pop() ?? null;
        restored.push(
          target === null
            ? child
            : textToken(state, `](${state.md.normalizeLinkText(target)})`),
        );
        continue;
      }
      restored.push(child);
    }
    blockToken.children = restored;
  }
}

// `<br>` (also `<br/>`, `<br />`) in text is a line break: the one piece of HTML a
// Markdown table cell needs, since a cell cannot hold a real line break. Everything else
// stays escaped text.
const LINE_BREAK_TAG = /<br\s*\/?>/i;

function lineBreakTags(state: StateCore): void {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== "inline" || blockToken.children === null) continue;
    const children: Token[] = [];
    for (const child of blockToken.children) {
      if (child.type !== "text" || !LINE_BREAK_TAG.test(child.content)) {
        children.push(child);
        continue;
      }
      child.content.split(LINE_BREAK_TAG).forEach((part, index) => {
        if (index > 0) children.push(new state.Token("hardbreak", "br", 0));
        if (part !== "") children.push(textToken(state, part));
      });
    }
    blockToken.children = children;
  }
}

function textToken(state: StateCore, content: string): Token {
  const token = new state.Token("text", "", 0);
  token.content = content;
  return token;
}

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
  // A relative path (no scheme at all) also passes, for images; a relative link is turned
  // back into text by `restoreUnlinkableLinks`.
  renderer.validateLink = (url) => {
    const trimmed = url.trim();
    return LINK_URL_PATTERN.test(trimmed) || !URL_SCHEME_PATTERN.test(trimmed);
  };
  renderer.core.ruler.after("inline", "restore_unlinkable_links", (state) => {
    restoreUnlinkableLinks(state);
  });
  // Last: after the text of a line has been joined into one token.
  renderer.core.ruler.push("line_break_tags", (state) => {
    lineBreakTags(state);
  });
  // A column's alignment becomes a class: `style` stays forbidden everywhere.
  for (const rule of TABLE_CELL_OPEN_RULES) {
    renderer.renderer.rules[rule] = (tokens, index, options, _env, self) => {
      const token = tokens[index];
      if (token === undefined) return "";
      const style = stringAttribute(token, STYLE_ATTRIBUTE);
      if (style !== null) {
        token.attrs =
          token.attrs?.filter(([name]) => name !== STYLE_ATTRIBUTE) ?? null;
        const alignment = ALIGNMENT_STYLE.exec(style)?.[1];
        if (alignment !== undefined) {
          token.attrJoin(
            CLASS_ATTRIBUTE,
            `${MARKDOWN_CLASS_NAMES.alignPrefix}${alignment}`,
          );
        }
      }
      // The cell's text is the inline token after it.
      const text = tokens[index + 1]?.content ?? "";
      if (
        text !== "" &&
        !WHITESPACE.test(text) &&
        !text.includes(LINE_BREAK_MARK) &&
        [...text].length <= SHORT_CELL_MAX_CHARACTERS
      ) {
        token.attrJoin(CLASS_ATTRIBUTE, MARKDOWN_CLASS_NAMES.shortCell);
      }
      return self.renderToken(tokens, index, options);
    };
  }
  // Only an asset of the block's own Document is shown, through the asset URL (no network
  // access from a note, no file access outside the Document). Any other image shows its
  // alt text instead.
  renderer.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token === undefined) return "";
    const altText = renderer.utils.escapeHtml(
      self.renderInlineAsText(token.children ?? [], options, env),
    );
    const images = isRenderEnvironment(env) ? env.images : undefined;
    const destination = stringAttribute(token, IMAGE_SOURCE_ATTRIBUTE);
    const assetPath =
      images === undefined || destination === null
        ? null
        : resolveMarkdownImagePath(images.markdownContentPath, destination);
    if (images === undefined || assetPath === null) {
      return `<span class="${MARKDOWN_CLASS_NAMES.imageAlt}">${altText}</span>`;
    }
    const source = renderer.utils.escapeHtml(images.urlFor(assetPath));
    return `<img src="${source}" alt="${altText}">`;
  };
  return renderer;
}

const markdownRenderer = createMarkdownRenderer();

// The assets of the Document a Markdown file at `markdownContentPath` shows as images, each
// once, in order. Read from markdown-it's tokens, so an image written inside code is not
// one.
export function markdownImageAssets(
  source: string,
  markdownContentPath: string,
): readonly ContentPath[] {
  const found: ContentPath[] = [];
  const visit = (tokens: readonly Token[]) => {
    for (const token of tokens) {
      if (token.children !== null) visit(token.children);
      if (token.type !== "image") continue;
      const destination = stringAttribute(token, IMAGE_SOURCE_ATTRIBUTE);
      const assetPath =
        destination === null
          ? null
          : resolveMarkdownImagePath(markdownContentPath, destination);
      if (assetPath !== null && !found.includes(assetPath))
        found.push(assetPath);
    }
  };
  visit(markdownRenderer.parse(source, {}));
  return found;
}

// Unsanitised HTML: exposed for tests of stage one only; a plain string cannot be handed to
// `MarkdownPreview`.
export function renderMarkdownToHtml(
  source: string,
  images?: MarkdownImageContext,
): string {
  const environment: RenderEnvironment = images === undefined ? {} : { images };
  return markdownRenderer.render(source, environment);
}

export function renderMarkdown(
  source: string,
  images?: MarkdownImageContext,
): SanitizedHtml {
  return sanitizeHtml(
    renderMarkdownToHtml(source, images),
    images === undefined ? {} : { imageSourcePrefix: images.urlPrefix },
  );
}
