import type { ResolvedTheme } from "../../application/local-state/theme";
import type { OsThemeSource } from "../../application/ports/os-theme-source";

// Query that matches while the OS asks for a dark appearance. Reading it through the
// webview needs no Tauri permission.
export const DARK_COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

const DARK_THEME: ResolvedTheme = "dark";
const LIGHT_THEME: ResolvedTheme = "light";

export interface ThemeMediaQueryList {
  readonly matches: boolean;
  addEventListener(
    type: "change",
    listener: (event: { readonly matches: boolean }) => void,
  ): void;
  removeEventListener(
    type: "change",
    listener: (event: { readonly matches: boolean }) => void,
  ): void;
}

export type MatchMedia = (query: string) => ThemeMediaQueryList;

function themeOf(matchesDark: boolean): ResolvedTheme {
  return matchesDark ? DARK_THEME : LIGHT_THEME;
}

// `matchMedia` is a parameter so tests can pass a fake; undefined means the host has none.
export function createMatchMediaOsThemeSource(
  matchMedia: MatchMedia | undefined,
): OsThemeSource {
  if (matchMedia === undefined) {
    return { current: () => null, subscribe: () => () => {} };
  }
  const query = matchMedia(DARK_COLOR_SCHEME_QUERY);
  return {
    current: () => themeOf(query.matches),
    subscribe(listener) {
      const onChange = (event: { readonly matches: boolean }) =>
        listener(themeOf(event.matches));
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
  };
}
