// DOM helpers for the Markdown security tests. Not imported by production code.

import {
  ALLOWED_LINK_SCHEMES,
  SANITIZER_ALLOWED_ATTRIBUTES,
  SANITIZER_ALLOWED_TAGS,
  SANITIZER_FORBIDDEN_TAGS,
} from "../markdown-config";

// Parsed into an inert document: nothing in it loads or runs.
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><body>${html}</body>`,
    "text/html",
  );
}

const ALLOWED_TAGS: ReadonlySet<string> = new Set(SANITIZER_ALLOWED_TAGS);
const FORBIDDEN_TAGS: ReadonlySet<string> = new Set(SANITIZER_FORBIDDEN_TAGS);
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set(
  SANITIZER_ALLOWED_ATTRIBUTES,
);

function hrefHasAllowedScheme(href: string): boolean {
  return ALLOWED_LINK_SCHEMES.some((scheme) =>
    href.toLowerCase().startsWith(`${scheme}:`),
  );
}

// Everything the whole-document rule forbids, as readable messages (empty = safe): only
// allow-listed tags and attributes, no `on*` attribute, no `style`, hrefs only with an
// allowed scheme, none of the forbidden tags.
export function unsafeFindings(document: Document): string[] {
  const findings: string[] = [];
  for (const element of document.body.querySelectorAll("*")) {
    const tag = element.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tag)) findings.push(`forbidden tag <${tag}>`);
    else if (!ALLOWED_TAGS.has(tag)) {
      findings.push(`tag not on the allow list <${tag}>`);
    }
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) findings.push(`event handler ${name}`);
      if (name === "style") findings.push("style attribute");
      if (!ALLOWED_ATTRIBUTES.has(name)) {
        findings.push(`attribute not on the allow list ${name}`);
      }
      if (name === "href" && !hrefHasAllowedScheme(attribute.value)) {
        findings.push(`href with a disallowed scheme: ${attribute.value}`);
      }
    }
  }
  return findings;
}
