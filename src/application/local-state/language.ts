// Parsing of the language preference setting (docs/architecture.md §6.2.2). The values live
// in `config/language-config.ts`; this is the TypeScript twin of Rust's `LanguagePreference`.

import {
  LANGUAGE_PREFERENCES,
  type LanguagePreference,
} from "../../config/language-config";
import {
  type LocalStateResult,
  localStateErr,
  localStateOk,
} from "./local-state-result";

// Case-sensitive and without trimming, like the Rust parser.
export function parseLanguagePreference(
  value: string,
): LocalStateResult<LanguagePreference> {
  const match = LANGUAGE_PREFERENCES.find((candidate) => candidate === value);
  return match === undefined
    ? localStateErr(
        "invalidLanguagePreference",
        `not a language preference: ${JSON.stringify(value)}`,
      )
    : localStateOk(match);
}
