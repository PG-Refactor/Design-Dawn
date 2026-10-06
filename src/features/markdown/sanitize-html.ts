// The second stage of the Markdown pipeline (docs/security.md §3): whatever HTML comes in,
// only an explicit allow list comes out. It does not trust markdown-it's output.

import createDOMPurify, { type Config, type DOMPurify } from "dompurify";
import {
  ALLOWED_CLASS_PATTERN,
  LINK_URL_PATTERN,
  SANITIZER_ALLOWED_ATTRIBUTES,
  SANITIZER_ALLOWED_TAGS,
  SANITIZER_FORBIDDEN_ATTRIBUTES,
  SANITIZER_FORBIDDEN_TAGS,
  SANITIZER_PLAIN_VALUE_ATTRIBUTES,
} from "./markdown-config";

declare const sanitizedHtmlBrand: unique symbol;

// HTML that went through `sanitizeHtml`. Only this module produces the type, so a
// component that asks for it (the preview, the one place that injects HTML) cannot be
// handed an unsanitised string.
export type SanitizedHtml = string & { readonly [sanitizedHtmlBrand]: true };

const SANITIZER_CONFIG: Config = {
  ALLOWED_TAGS: [...SANITIZER_ALLOWED_TAGS],
  ALLOWED_ATTR: [...SANITIZER_ALLOWED_ATTRIBUTES],
  ADD_URI_SAFE_ATTR: [...SANITIZER_PLAIN_VALUE_ATTRIBUTES],
  ALLOWED_URI_REGEXP: LINK_URL_PATTERN,
  FORBID_TAGS: [...SANITIZER_FORBIDDEN_TAGS],
  FORBID_ATTR: [...SANITIZER_FORBIDDEN_ATTRIBUTES],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  // The result is a string for the preview, not a DOM node.
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  WHOLE_DOCUMENT: false,
};

let purifier: DOMPurify | null = null;

// Created on first use so importing this module does not need a DOM. Without one DOMPurify
// would hand the input back untouched, so that case is an error, never a pass-through.
function getPurifier(): DOMPurify {
  if (purifier !== null) return purifier;
  if (typeof window === "undefined") {
    throw new Error("HTML sanitising needs a DOM (window is not available)");
  }
  const instance = createDOMPurify(window);
  if (!instance.isSupported) {
    throw new Error("DOMPurify is not supported in this environment");
  }
  // `class` stays allowed for code languages, but only with the values we generate.
  instance.addHook("uponSanitizeAttribute", (_node, data) => {
    if (
      data.attrName === "class" &&
      !ALLOWED_CLASS_PATTERN.test(data.attrValue)
    ) {
      data.keepAttr = false;
    }
  });
  purifier = instance;
  return instance;
}

export function sanitizeHtml(html: string): SanitizedHtml {
  // DOMPurify's string overload; the cast is the one place the brand is earned.
  return String(
    getPurifier().sanitize(html, SANITIZER_CONFIG),
  ) as SanitizedHtml;
}
