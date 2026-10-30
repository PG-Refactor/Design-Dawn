// The second stage of the Mermaid pipeline (docs/architecture.md §15.4, docs/security.md
// §7): whatever SVG Mermaid produced, only SVG that cannot reach outside the image comes
// out. It does not trust Mermaid's own sanitising. The result is shown through <img>,
// which runs no script and loads nothing, so this is the second of two defences.
//
// A separate DOMPurify instance from the Markdown one: hooks and settings of the two must
// never mix.

import createDOMPurify, { type Config, type DOMPurify } from "dompurify";
import {
  filterDeclarationList,
  filterStylesheet,
  isReferenceSafeValue,
} from "./css-reference-filter";

declare const sanitizedSvgBrand: unique symbol;

// SVG that went through `sanitizeSvg`. Only this module produces the type, so code that
// turns SVG into an image URL cannot be handed an unsanitised string.
export type SanitizedSvg = string & { readonly [sanitizedSvgBrand]: true };

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_ROOT_TAG = "svg";
const SVG_GROUP_TAG = "g";
const VIEW_BOX_ATTRIBUTE = "viewBox";
const VIEW_BOX_PARTS = 4;
const VIEW_BOX_WIDTH_INDEX = 2;
const VIEW_BOX_HEIGHT_INDEX = 3;

// Elements that can run script, embed other documents or load other files. `a` is dropped
// as well: Mermaid draws `click` links as <a> even at the strict security level, and a
// link in an image would have nowhere to go. DOMPurify keeps the text of a removed element.
const LINK_TAG = "a";
const FORBIDDEN_TAGS = [
  "script",
  "foreignObject",
  "iframe",
  "object",
  "embed",
  "image",
  LINK_TAG,
] as const;

// Mermaid puts the position of a `click` node on the <a> around it, not on the node, so
// dropping the <a> alone would move the node to the origin. The one attribute carried over
// to the <g> that takes the link's place (see `keepLinkPosition`).
const TRANSFORM_ATTRIBUTE = "transform";

// A transform made only of SVG transform functions with plain numbers, which cannot name
// anything outside the image. Anything else is not carried over. The number of arguments
// each function takes (SVG 1.1 §7.6).
const TRANSFORM_ARGUMENT_COUNTS: Readonly<Record<string, readonly number[]>> = {
  matrix: [6],
  translate: [1, 2],
  scale: [1, 2],
  rotate: [1, 3],
  skewX: [1],
  skewY: [1],
};
const TRANSFORM_FUNCTION_PATTERN = /^\s*([A-Za-z]+)\s*\(([^()]*)\)\s*,?/;
const TRANSFORM_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const TRANSFORM_ARGUMENT_SEPARATOR = /\s*,\s*|\s+/;

// Not part of DOMPurify's SVG profile but needed: Mermaid puts the colours and strokes of a
// diagram into <style>. Its content is cleaned by `filterStylesheet`.
const EXTRA_TAGS = ["style"] as const;

const REFERENCE_ATTRIBUTES = ["href", "xlink:href"] as const;
const INTERNAL_REFERENCE_PREFIX = "#";

// Presentation attributes whose value is CSS and can carry url(...) or another resource
// reference. They are checked as a CSS value and dropped whole when rejected. Every other
// attribute (aria-label, id, class, d, transform, ...) is left exactly as it is.
const CSS_VALUE_ATTRIBUTES = [
  "fill",
  "stroke",
  "filter",
  "clip-path",
  "mask",
  "marker",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
] as const;
const STYLE_ATTRIBUTE = "style";

const SANITIZER_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: [...EXTRA_TAGS],
  FORBID_TAGS: [...FORBIDDEN_TAGS],
  // The result is read as a DOM tree, then serialised as XML (see `serialize`).
  RETURN_DOM: true,
  WHOLE_DOCUMENT: false,
} satisfies Config & { readonly RETURN_DOM: true };

let purifier: DOMPurify | null = null;

// Created on first use so importing this module does not need a DOM. Without one DOMPurify
// would hand the input back untouched, so that case is an error, never a pass-through.
function getPurifier(): DOMPurify {
  if (purifier !== null) return purifier;
  if (typeof window === "undefined") {
    throw new Error("SVG sanitising needs a DOM (window is not available)");
  }
  const instance = createDOMPurify(window);
  if (!instance.isSupported) {
    throw new Error("DOMPurify is not supported in this environment");
  }
  instance.addHook("uponSanitizeAttribute", (_node, data) => {
    if (
      (REFERENCE_ATTRIBUTES as readonly string[]).includes(data.attrName) &&
      !data.attrValue.trim().startsWith(INTERNAL_REFERENCE_PREFIX)
    ) {
      data.keepAttr = false;
      return;
    }
    if (data.attrName === STYLE_ATTRIBUTE) {
      const filtered = filterDeclarationList(data.attrValue);
      if (filtered === null) data.keepAttr = false;
      else data.attrValue = filtered;
      return;
    }
    if (
      (CSS_VALUE_ATTRIBUTES as readonly string[]).includes(data.attrName) &&
      !isReferenceSafeValue(data.attrValue)
    ) {
      data.keepAttr = false;
    }
  });
  instance.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName === "style") {
      node.textContent = filterStylesheet(node.textContent ?? "") ?? "";
      return;
    }
    if (data.tagName === LINK_TAG && node instanceof Element) {
      keepLinkPosition(node);
    }
  });
  purifier = instance;
  return instance;
}

export function isSafeTransform(value: string): boolean {
  let rest = value.trim();
  if (rest === "") return false;
  while (rest !== "") {
    const match = TRANSFORM_FUNCTION_PATTERN.exec(rest);
    if (match === null) return false;
    const [whole, name = "", argumentText = ""] = match;
    const allowedCounts = Object.hasOwn(TRANSFORM_ARGUMENT_COUNTS, name)
      ? TRANSFORM_ARGUMENT_COUNTS[name]
      : undefined;
    const trimmedArguments = argumentText.trim();
    const argumentList =
      trimmedArguments === ""
        ? []
        : trimmedArguments.split(TRANSFORM_ARGUMENT_SEPARATOR);
    if (
      allowedCounts === undefined ||
      !allowedCounts.includes(argumentList.length) ||
      !argumentList.every((argument) => TRANSFORM_NUMBER_PATTERN.test(argument))
    ) {
      return false;
    }
    rest = rest.slice(whole.length).trimStart();
  }
  return true;
}

// Runs while the <a> is still in the tree, just before DOMPurify drops it. Its children are
// moved into a new <g> that has the link's transform and nothing else: no href, no event
// handler, no data-* or class is copied. DOMPurify then hoists the <g> in place of the <a>
// and sanitises it and everything inside it like any other element, so the <g> gets no
// exemption. An <a> without a safe transform is left alone and its children are hoisted
// as before.
function keepLinkPosition(link: Element): void {
  const transform = link.getAttribute(TRANSFORM_ATTRIBUTE);
  if (
    link.namespaceURI !== SVG_NAMESPACE ||
    transform === null ||
    !isSafeTransform(transform)
  ) {
    return;
  }
  const group = link.ownerDocument.createElementNS(
    SVG_NAMESPACE,
    SVG_GROUP_TAG,
  );
  group.setAttribute(TRANSFORM_ATTRIBUTE, transform);
  while (link.firstChild !== null) group.appendChild(link.firstChild);
  link.appendChild(group);
}

// The root width is usually "100%" (Mermaid's max-width mode), which gives the image no
// size of its own and lets it grow past its natural size. The viewBox has the real size.
function giveIntrinsicSize(root: Element): void {
  const parts = (root.getAttribute(VIEW_BOX_ATTRIBUTE) ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = parts[VIEW_BOX_WIDTH_INDEX];
  const height = parts[VIEW_BOX_HEIGHT_INDEX];
  if (
    parts.length !== VIEW_BOX_PARTS ||
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return;
  }
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
}

// An image/svg+xml file must be well-formed XML. Mermaid's string comes from innerHTML
// (HTML syntax, for example `&nbsp;`), so the cleaned tree is serialised as XML instead.
function serialize(root: Element): string {
  return new XMLSerializer().serializeToString(root);
}

export function sanitizeSvg(svg: string): SanitizedSvg {
  const body = getPurifier().sanitize(svg, SANITIZER_CONFIG);
  const root = body instanceof Element ? body.firstElementChild : null;
  if (
    !(body instanceof Element) ||
    root === null ||
    root.localName !== SVG_ROOT_TAG ||
    root.namespaceURI !== SVG_NAMESPACE ||
    body.childElementCount !== 1
  ) {
    throw new Error("The diagram did not produce a single SVG image");
  }
  giveIntrinsicSize(root);
  // The cast is the one place the brand is earned.
  return serialize(root) as SanitizedSvg;
}
