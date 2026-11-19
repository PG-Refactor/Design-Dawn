// Single place for everything that decides what rendered Markdown may contain.
// markdown-it and DOMPurify both read it, so the two stages cannot
// drift apart.

// Only these URL schemes become links. Relative links, fragments (`#top`) and every other
// scheme are not links at all: a note has no base URL to resolve them against, and links
// are display-only anyway (the preview never navigates).
export const ALLOWED_LINK_SCHEMES = ["http", "https", "mailto"] as const;

export const LINK_URL_PATTERN = new RegExp(
  `^(?:${ALLOWED_LINK_SCHEMES.join("|")}):`,
  "i",
);

// Any scheme at the start of a destination (`https:`, `javascript:`, `C:`). A destination
// without one is a relative path: allowed for an image of the block's own Document, never
// a link.
export const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export const MARKDOWN_CLASS_NAMES = {
  imageAlt: "markdown-image-alt",
  // Followed by `left`, `center` or `right`: a table column's alignment.
  alignPrefix: "markdown-align-",
  // A table cell with a short value (a name, a date, a status): kept on one line, so a
  // table does not split it while a long cell next to it takes the width.
  shortCell: "markdown-cell-short",
} as const;

// At most this many characters, with no space, make a cell short.
export const SHORT_CELL_MAX_CHARACTERS = 8;

export const TABLE_ALIGNMENTS = ["left", "center", "right"] as const;

// The image source attribute. It is not checked against the link pattern above: the
// sanitiser keeps it only when it is an asset URL of the block's own Document (see
// `sanitizeHtml`), and drops it otherwise.
export const IMAGE_SOURCE_ATTRIBUTE = "src";

// The only class values that survive sanitising: the language class of a fenced code
// block, the image-alt marker and a table column's alignment. Anything else is dropped
// even if markup carries it.
const ALLOWED_CLASS_SOURCE = `(?:language-[A-Za-z0-9_+#.-]+|${MARKDOWN_CLASS_NAMES.imageAlt}|${MARKDOWN_CLASS_NAMES.alignPrefix}(?:${TABLE_ALIGNMENTS.join("|")})|${MARKDOWN_CLASS_NAMES.shortCell})`;
// One of the classes we generate, or several separated by a space (a table cell can be
// aligned and short).
export const ALLOWED_CLASS_PATTERN = new RegExp(
  `^${ALLOWED_CLASS_SOURCE}(?: ${ALLOWED_CLASS_SOURCE})*$`,
);

// What the markdown-it configuration can emit. Alignment is never `style`: the renderer
// turns markdown-it's `style="text-align:…"` into an alignment class.
export const SANITIZER_ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "strong",
  "em",
  "s",
  "del",
  "blockquote",
  "ul",
  "ol",
  "li",
  "code",
  "pre",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "span",
  "img",
] as const;

// `start` is the first number of an ordered list; `src` and `alt` belong to an image.
export const SANITIZER_ALLOWED_ATTRIBUTES = [
  "href",
  "class",
  "start",
  IMAGE_SOURCE_ATTRIBUTE,
  "alt",
] as const;

// Attributes DOMPurify must treat as plain values instead of URLs (it tests every other
// attribute value against the URL pattern above). `src` is listed because its own check
// is stricter than the link pattern, and runs in the sanitiser's hook.
export const SANITIZER_PLAIN_VALUE_ATTRIBUTES = [
  "start",
  "alt",
  IMAGE_SOURCE_ATTRIBUTE,
] as const;

// Explicit even though they are not allowed: the deny list survives a careless edit of
// the allow list.
export const SANITIZER_FORBIDDEN_TAGS = [
  "svg",
  "math",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "script",
  "style",
  "link",
  "meta",
  "base",
] as const;

export const SANITIZER_FORBIDDEN_ATTRIBUTES = ["style"] as const;
