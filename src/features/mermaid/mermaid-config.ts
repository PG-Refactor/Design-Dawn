// The one place that fixes the security-relevant Mermaid settings. Only the theme values vary. `maxTextSize` and `maxEdges` are
// deliberately not set: the upstream defaults are the limits.

import type { MermaidThemeValues } from "./mermaid-renderer-types";

// Mermaid 12.1.0's own default `secure` list (defaultConfig in
// node_modules/mermaid/dist/chunks/mermaid.core/chunk-VPRB5NB3.mjs). Setting `secure`
// replaces the default instead of extending it, so the defaults are repeated here; a test
// keeps the two lists in step with what Mermaid exposes.
export const MERMAID_DEFAULT_SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
] as const;

// `secure` keys cannot be changed by directives (%%{init}%%, front matter) inside a
// diagram. `htmlLabels` is added: it is app-fixed, and without this a diagram could turn
// HTML labels (foreignObject) back on.
export const MERMAID_SECURE_KEYS: readonly string[] = [
  ...MERMAID_DEFAULT_SECURE_KEYS,
  "htmlLabels",
];

export const MERMAID_FIXED_CONFIG = {
  // Nothing scans the page for diagrams; the app renders explicitly.
  startOnLoad: false,
  // Turns HTML in labels into text and disables click handlers.
  securityLevel: "strict",
  // Labels become SVG text. The SVG is shown as an image, which cannot draw the
  // foreignObject elements that HTML labels need, and the HTML path is gone.
  htmlLabels: false,
  // A failed render throws instead of putting an error diagram into the page.
  suppressErrorRendering: true,
  deterministicIds: true,
  // The only theme whose colours come entirely from `themeVariables`.
  theme: "base",
} as const;

export interface MermaidInitializeConfig {
  readonly startOnLoad: false;
  readonly securityLevel: "strict";
  readonly htmlLabels: false;
  readonly suppressErrorRendering: true;
  readonly deterministicIds: true;
  readonly theme: "base";
  readonly secure: string[];
  readonly themeVariables: Record<string, string | boolean>;
}

// Only resolved values go in: an empty string would override Mermaid's default with
// something it cannot parse as a colour.
function definedThemeVariables(
  theme: MermaidThemeValues,
): Record<string, string | boolean> {
  const variables: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(theme)) {
    if (
      typeof value === "boolean" ||
      (typeof value === "string" && value !== "")
    )
      variables[name] = value;
  }
  return variables;
}

export function buildMermaidConfig(
  theme: MermaidThemeValues,
): MermaidInitializeConfig {
  return {
    ...MERMAID_FIXED_CONFIG,
    secure: [...MERMAID_SECURE_KEYS],
    themeVariables: definedThemeVariables(theme),
  };
}
