// Preference -> display language derivation. Pure: the system languages are passed in, and
// reading them from the WebView is the job of a `SystemLanguageSource`.

import {
  DISPLAY_LANGUAGES,
  type DisplayLanguage,
  FALLBACK_DISPLAY_LANGUAGE,
  type LanguagePreference,
  SYSTEM_LANGUAGE_PREFERENCE,
} from "../../config/language-config";

const LANGUAGE_SUBTAG_SEPARATOR = "-";

// Language tags are case-insensitive (BCP 47) and matched by their whole primary subtag, so
// "ja-JP" is Japanese but "jam" is not.
function displayLanguageOf(tag: string): DisplayLanguage | null {
  const primary = tag.toLowerCase().split(LANGUAGE_SUBTAG_SEPARATOR)[0];
  return DISPLAY_LANGUAGES.find((language) => language === primary) ?? null;
}

// `systemLanguages` is in the user's order of preference (like `navigator.languages`): the
// first one the UI has text for wins, so ["en-US", "ja"] stays English while ["fr", "ja"]
// becomes Japanese.
export function resolveDisplayLanguage(
  preference: LanguagePreference,
  systemLanguages: readonly string[],
): DisplayLanguage {
  if (preference !== SYSTEM_LANGUAGE_PREFERENCE) return preference;
  for (const tag of systemLanguages) {
    const language = displayLanguageOf(tag);
    if (language !== null) return language;
  }
  return FALLBACK_DISPLAY_LANGUAGE;
}
