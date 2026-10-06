import type { ResolvedTheme } from "../../application/local-state/theme";

// Root attribute the token stylesheet selects on (`:root[data-theme="…"]`).
export const THEME_ATTRIBUTE_NAME = "data-theme";

// The part of an element `applyTheme` needs, so tests can pass a plain object.
export interface ThemeTarget {
  setAttribute(name: string, value: string): void;
  readonly style: { colorScheme: string };
}

// `color-scheme` is set as well so scrollbars and form controls match the theme. The
// theme ids double as valid `color-scheme` values ("light" / "dark").
export function applyTheme(target: ThemeTarget, theme: ResolvedTheme): void {
  target.setAttribute(THEME_ATTRIBUTE_NAME, theme);
  target.style.colorScheme = theme;
}
