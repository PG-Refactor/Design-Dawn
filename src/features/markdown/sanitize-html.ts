// The second stage of the Markdown pipeline: whatever HTML comes in,
// only an explicit allow list comes out. It does not trust markdown-it's output.

import createDOMPurify, { type Config, type DOMPurify } from "dompurify";
import {
  ALLOWED_CLASS_PATTERN,
  IMAGE_SOURCE_ATTRIBUTE,
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

// What an image may load from in the call in progress (DOMPurify's hooks are per
// instance, sanitising is synchronous). Null: no image may load at all.
let allowedImageSourcePrefix: string | null = null;

function isAllowedImageSource(nodeName: string, value: string): boolean {
  return (
    nodeName === "IMG" &&
    allowedImageSourcePrefix !== null &&
    value.startsWith(allowedImageSourcePrefix)
  );
}

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
  instance.addHook("uponSanitizeAttribute", (node, data) => {
    if (
      data.attrName === "class" &&
      !ALLOWED_CLASS_PATTERN.test(data.attrValue)
    ) {
      data.keepAttr = false;
    }
    if (
      data.attrName === IMAGE_SOURCE_ATTRIBUTE &&
      !isAllowedImageSource(node.nodeName, data.attrValue)
    ) {
      data.keepAttr = false;
    }
  });
  // An image whose source was refused would be an empty box; it is removed instead.
  instance.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "IMG" && !node.hasAttribute(IMAGE_SOURCE_ATTRIBUTE)) {
      node.remove();
    }
  });
  purifier = instance;
  return instance;
}

export interface SanitizeOptions {
  // Images survive only when their `src` starts with this prefix: the asset URL of one
  // Document. Without it every image is removed.
  readonly imageSourcePrefix?: string;
}

export function sanitizeHtml(
  html: string,
  options: SanitizeOptions = {},
): SanitizedHtml {
  const instance = getPurifier();
  allowedImageSourcePrefix = options.imageSourcePrefix ?? null;
  try {
    // DOMPurify's string overload; the cast is the one place the brand is earned.
    return String(instance.sanitize(html, SANITIZER_CONFIG)) as SanitizedHtml;
  } finally {
    allowedImageSourcePrefix = null;
  }
}

// Only pictures the app made itself (images read from a Git version): `data:` URLs of an
// image type, nothing that could carry markup into an attribute.
const IMAGE_DATA_URL_PATTERN =
  /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;

// Shows other pictures in place of some of the image sources of sanitised HTML: each
// `src="<url>"` whose URL is a key gets the `data:` URL it maps to. A value that is not an
// image `data:` URL is ignored, so the result stays as safe as the input.
export function withImageSources(
  html: SanitizedHtml,
  sources: ReadonlyMap<string, string>,
): SanitizedHtml {
  let result: string = html;
  for (const [url, dataUrl] of sources) {
    if (!IMAGE_DATA_URL_PATTERN.test(dataUrl)) continue;
    result = result.split(`src="${url}"`).join(`src="${dataUrl}"`);
  }
  return result as SanitizedHtml;
}
