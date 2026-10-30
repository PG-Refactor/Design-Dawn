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

export const MARKDOWN_CLASS_NAMES = {
  imageAlt: "markdown-image-alt",
} as const;

// The only class values that survive sanitising: the language class of a fenced code
// block and the image-alt marker. Anything else is dropped even if markup carries it.
export const ALLOWED_CLASS_PATTERN = new RegExp(
  `^(?:language-[A-Za-z0-9_+#.-]+|${MARKDOWN_CLASS_NAMES.imageAlt})$`,
);

// What the markdown-it configuration can emit. Alignment (`style`) is deliberately not
// part of it: tables lose their column alignment instead of allowing `style`.
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
] as const;

// `start` is the first number of an ordered list.
export const SANITIZER_ALLOWED_ATTRIBUTES = ["href", "class", "start"] as const;

// Attributes DOMPurify must treat as plain values instead of URLs (it tests every other
// attribute value against the URL pattern above).
export const SANITIZER_PLAIN_VALUE_ATTRIBUTES = ["start"] as const;

// Explicit even though they are not allowed: the deny list survives a careless edit of
// the allow list.
export const SANITIZER_FORBIDDEN_TAGS = [
  "img",
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
