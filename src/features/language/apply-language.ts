import type { DisplayLanguage } from "../../config/language-config";

// The part of the root element `applyLanguage` needs, so tests can pass a plain object.
export interface LanguageTarget {
  lang: string;
}

// Display language ids are valid BCP 47 tags ("en", "ja"), so the id is the `lang` value.
// It lets assistive technology and the browser (hyphenation, font selection, spell check)
// treat the page text in the language it is actually shown in.
export function applyLanguage(
  target: LanguageTarget,
  language: DisplayLanguage,
): void {
  target.lang = language;
}
