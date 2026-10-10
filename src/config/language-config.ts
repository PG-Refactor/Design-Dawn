// Display language values (docs/requirements.md §18). Mirrors `LANGUAGE_IDS` in Rust
// (`application/local_state/constants.rs`); adding a language means adding it in both.

// Language definition table: the languages the UI has text for.
export const DISPLAY_LANGUAGES = ["en", "ja"] as const;

// The language actually used for the UI text.
export type DisplayLanguage = (typeof DISPLAY_LANGUAGES)[number];

// Preference that follows the language of the WebView.
export const SYSTEM_LANGUAGE_PREFERENCE = "system";

export type LanguagePreference =
  | typeof SYSTEM_LANGUAGE_PREFERENCE
  | DisplayLanguage;

export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = [
  SYSTEM_LANGUAGE_PREFERENCE,
  ...DISPLAY_LANGUAGES,
];

export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference =
  SYSTEM_LANGUAGE_PREFERENCE;

// Used when no system language is one the UI has text for (or none is known).
export const FALLBACK_DISPLAY_LANGUAGE: DisplayLanguage = "en";
