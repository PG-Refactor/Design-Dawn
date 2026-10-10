// Display helpers of the history list. Pure, so they can be tested without a DOM.

import { SHORT_COMMIT_ID_LENGTH } from "../../config/git-config";
import {
  DISPLAY_LANGUAGE_LOCALES,
  type DisplayLanguage,
} from "../../config/language-config";

const HISTORY_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

export interface FormatCommitDateOptions {
  // Only for deterministic tests; the default is the local time zone.
  readonly timeZone?: string;
}

// The author date (ISO 8601 with an offset) in local time, in the display language's locale. An unreadable date is shown as
// it came, so no information is lost.
export function formatCommitDate(
  isoDate: string,
  language: DisplayLanguage,
  options: FormatCommitDateOptions = {},
): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat(DISPLAY_LANGUAGE_LOCALES[language], {
    ...HISTORY_DATE_FORMAT,
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
  }).format(parsed);
}

export function shortCommitId(commitId: string): string {
  return commitId.slice(0, SHORT_COMMIT_ID_LENGTH);
}
