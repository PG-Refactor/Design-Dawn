// Theme identifiers and the preference -> applied theme derivation (docs/architecture.md
// §13.1). Pure: the OS theme is passed in, and reading it from the OS / applying it to the
// UI is a later step. Mirrors `THEME_IDS` in Rust (`application/local_state/constants.rs`).

import {
  type LocalStateResult,
  localStateErr,
  localStateOk,
} from "./local-state-result";

// Theme definition table: adding a theme means adding a row here (and its id in Rust).
export const THEME_DEFINITIONS = [{ id: "light" }, { id: "dark" }] as const;

// The theme actually applied.
export type ResolvedTheme = (typeof THEME_DEFINITIONS)[number]["id"];

// Preference that follows the OS theme.
export const SYSTEM_THEME_PREFERENCE = "system";

export type ThemePreference = typeof SYSTEM_THEME_PREFERENCE | ResolvedTheme;

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  SYSTEM_THEME_PREFERENCE,
  ...THEME_DEFINITIONS.map((definition) => definition.id),
];

export const DEFAULT_THEME_PREFERENCE: ThemePreference =
  SYSTEM_THEME_PREFERENCE;

// Used when the OS theme cannot be determined.
export const FALLBACK_RESOLVED_THEME: ResolvedTheme = "light";

// Case-sensitive and without trimming, like the Rust parser.
export function parseThemePreference(
  value: string,
): LocalStateResult<ThemePreference> {
  const match = THEME_PREFERENCES.find((candidate) => candidate === value);
  return match === undefined
    ? localStateErr(
        "invalidThemePreference",
        `not a theme preference: ${JSON.stringify(value)}`,
      )
    : localStateOk(match);
}

// `osTheme` is null when the OS theme is unknown.
export function resolveTheme(
  preference: ThemePreference,
  osTheme: ResolvedTheme | null,
): ResolvedTheme {
  if (preference === SYSTEM_THEME_PREFERENCE) {
    return osTheme ?? FALLBACK_RESOLVED_THEME;
  }
  return preference;
}
