import { type DomainResult, err, ok } from "../../shared/domain-result";
import {
  PIE_COMMENT_MARK,
  PIE_DIRECTIVE_MARK,
  PIE_LABEL_QUOTE,
  PIE_QUOTE_ENTITY,
} from "./pie-config";

// Text rules of the pie editor. They mirror what Mermaid 12.1.0 does to the text before and
// while it reads a pie chart (docs/architecture.md §16.13), because a label or title is only
// safe to write if Mermaid reads back exactly what was written.

// `<tag attr="v">` becomes `<tag attr='v'>` before parsing (mermaid preprocess `cleanupText`).
const MARKUP_PATTERN = /<(\w+)([^>]*)>/g;
const MARKUP_ATTRIBUTE_PATTERN = /="([^"]*)"/g;
// Entity-like text (`#quot;`, `#35;`) is rewritten before parsing and decoded when drawing,
// so it is never literal text. Mermaid's encodeEntities uses exactly this pattern.
const ENTITY_LIKE_PATTERN = /#\w+;/;
// `style ... : #... ;` and `classDef ...` lines lose their last `;` in encodeEntities.
const STYLE_LIKE_PATTERNS: readonly RegExp[] = [
  /style.*:\S*#.*;/,
  /classDef.*:\S*#.*;/,
];
const LONE_CARRIAGE_RETURN_PATTERN = /\r(?!\n)/;
// C0 controls, DEL, C1 controls (which include NEL) and the Unicode line / paragraph
// separators.
const C0_CONTROL_MAX = 0x1f;
const DELETE_CODE = 0x7f;
const C1_CONTROL_MAX = 0x9f;
const LINE_SEPARATOR_CODE = 0x2028;
const PARAGRAPH_SEPARATOR_CODE = 0x2029;
const UNSIGNED_VALUE_PATTERN = /^(?:[0-9]+\.[0-9]+|(?:0|[1-9][0-9]*))$/;
const REPEATED_BLANK_PATTERN = /[\t ]{2,}/;

export function hasLoneCarriageReturn(source: string): boolean {
  return LONE_CARRIAGE_RETURN_PATTERN.test(source);
}

// True when Mermaid would rewrite markup-like text in `text` before reading it.
export function hasMarkupRewrite(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n");
  const rewritten = normalized.replace(
    MARKUP_PATTERN,
    (_match, tag: string, attributes: string) =>
      `<${tag}${attributes.replace(MARKUP_ATTRIBUTE_PATTERN, "='$1'")}>`,
  );
  return rewritten !== normalized;
}

export function hasStyleLikeText(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n");
  return STYLE_LIKE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (
      code <= C0_CONTROL_MAX ||
      (code >= DELETE_CODE && code <= C1_CONTROL_MAX) ||
      code === LINE_SEPARATOR_CODE ||
      code === PARAGRAPH_SEPARATOR_CODE
    ) {
      return true;
    }
  }
  return false;
}

export function isUnsignedPieValueText(text: string): boolean {
  return UNSIGNED_VALUE_PATTERN.test(text);
}

// Mermaid trims a title and folds runs of blanks into one space.
export function normalizePieTitle(text: string): string {
  return text.trim().replace(/[\t ]{2,}/g, " ");
}

// Validates the text of a new slice value. The user's text is kept as it is (no
// reformatting); negative numbers are refused because Mermaid rejects the whole chart.
export function validatePieValueText(text: string): DomainResult<number> {
  if (text.startsWith("-")) {
    return err(
      "invalidDiagramOperation",
      "negativeValue: a pie value must not be negative",
    );
  }
  if (!isUnsignedPieValueText(text)) {
    return err(
      "invalidDiagramOperation",
      "invalidValue: use digits with an optional fraction (no sign, exponent, or leading dot)",
    );
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return err(
      "invalidDiagramOperation",
      "valueOutOfRange: value is too large",
    );
  }
  return ok(value);
}

// Turns the text a person wants to see as a slice label into the text to write between the
// quotes, or refuses with a reason. A double quote is written as `#quot;`; everything else
// that could not be read back unchanged is refused rather than altered.
export function encodePieLabel(label: string): DomainResult<string> {
  if (hasControlCharacter(label)) {
    return err(
      "invalidDiagramOperation",
      "controlCharacter: a label cannot hold a line break, tab or control character",
    );
  }
  if (label.includes("\\")) {
    return err(
      "invalidDiagramOperation",
      "backslash: Mermaid treats a backslash in a label as an escape",
    );
  }
  if (label.includes(PIE_DIRECTIVE_MARK)) {
    return err(
      "invalidDiagramOperation",
      "directive: Mermaid removes %%{ ... }%% even inside a label",
    );
  }
  if (ENTITY_LIKE_PATTERN.test(label)) {
    return err(
      "invalidDiagramOperation",
      "entityLikeText: text such as #35; is read as an entity, not as written",
    );
  }
  const encoded = label.split(PIE_LABEL_QUOTE).join(PIE_QUOTE_ENTITY);
  return checkRewriteFree(encoded, "label");
}

// The inverse of the quote handling in `encodePieLabel`: the text a person sees for a label
// as written in the source. Only the quote entity is decoded, because it is the only one
// the editor ever writes (other entity-like text is refused when writing).
export function decodePieLabel(labelText: string): string {
  return labelText.split(PIE_QUOTE_ENTITY).join(PIE_LABEL_QUOTE);
}

export function validatePieTitle(title: string): DomainResult<string> {
  if (title.trim() === "") {
    return err(
      "invalidDiagramOperation",
      "emptyTitle: use removeTitle instead",
    );
  }
  if (hasControlCharacter(title)) {
    return err(
      "invalidDiagramOperation",
      "controlCharacter: a title cannot hold a line break, tab or control character",
    );
  }
  if (
    title !== normalizePieTitle(title) ||
    REPEATED_BLANK_PATTERN.test(title)
  ) {
    return err(
      "invalidDiagramOperation",
      "titleNotNormalized: Mermaid trims a title and folds repeated blanks, so the text would change",
    );
  }
  if (title.includes(PIE_COMMENT_MARK)) {
    return err(
      "invalidDiagramOperation",
      "comment: %% starts a comment inside a title line",
    );
  }
  if (ENTITY_LIKE_PATTERN.test(title)) {
    return err(
      "invalidDiagramOperation",
      "entityLikeText: text such as #35; is read as an entity, not as written",
    );
  }
  const checked = checkRewriteFree(title, "title");
  return checked.ok ? ok(title) : checked;
}

function checkRewriteFree(text: string, what: string): DomainResult<string> {
  if (hasMarkupRewrite(text)) {
    return err(
      "invalidDiagramOperation",
      `markup: Mermaid rewrites the quotes of markup-like text in a ${what}`,
    );
  }
  if (hasStyleLikeText(text)) {
    return err(
      "invalidDiagramOperation",
      `styleLikeText: Mermaid alters ${what} text that looks like a style definition`,
    );
  }
  return ok(text);
}
