import type { MermaidThemeValues } from "./mermaid-renderer-types";

// Which design token feeds which Mermaid theme variable. Colours are never written here:
// the values are read from the active theme (docs/architecture.md §13, §15.4).
type ThemeVariable = keyof MermaidThemeValues;

export const THEME_TOKENS: readonly (readonly [ThemeVariable, string])[] = [
  ["background", "--color-surface"],
  ["primaryColor", "--color-surface-raised"],
  ["primaryTextColor", "--color-text"],
  ["primaryBorderColor", "--color-border"],
  ["lineColor", "--color-text-muted"],
  ["secondaryColor", "--color-selection"],
  ["tertiaryColor", "--color-canvas-background"],
  ["textColor", "--color-text"],
  ["fontFamily", "--font-family-base"],
];

// Resolved at render time, after the theme attribute is on the root element, so a theme
// switch is picked up by the next render.
export function resolveMermaidTheme(root: Element): MermaidThemeValues {
  const style = getComputedStyle(root);
  const values: { -readonly [K in ThemeVariable]?: string } = {};
  for (const [variable, token] of THEME_TOKENS) {
    const value = style.getPropertyValue(token).trim();
    if (value !== "") values[variable] = value;
  }
  return values;
}
