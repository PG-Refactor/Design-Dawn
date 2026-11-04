import {
  DISPLAY_NAME_FORBIDDEN_CODE_POINT_RANGES,
  DISPLAY_NAME_MAX_CODE_POINTS,
  SURROGATE_CODE_UNIT_MAX,
  SURROGATE_CODE_UNIT_MIN,
  WHITESPACE_ONLY_PATTERN,
} from "../domain-constants";
import type { Brand } from "./brand";
import { type DomainResult, err, ok } from "./domain-result";

export type DisplayName = Brand<string, "DisplayName">;

function isForbiddenCodePoint(codePoint: number): boolean {
  return DISPLAY_NAME_FORBIDDEN_CODE_POINT_RANGES.some(
    ([first, last]) => codePoint >= first && codePoint <= last,
  );
}

function isLoneSurrogate(codePoint: number): boolean {
  return (
    codePoint >= SURROGATE_CODE_UNIT_MIN && codePoint <= SURROGATE_CODE_UNIT_MAX
  );
}

// Iterating a string yields code points, and a lone surrogate comes out as a single
// surrogate code point, so one pass covers length, control characters and surrogates.
// Shared with the other one-line texts (a Block caption), which differ only in length.
export function findCodePointViolation(
  value: string,
  maxCodePoints: number = DISPLAY_NAME_MAX_CODE_POINTS,
): string | null {
  let codePointCount = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (isForbiddenCodePoint(codePoint)) {
      return `contains control character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    }
    if (isLoneSurrogate(codePoint)) {
      return "contains a lone surrogate";
    }
    codePointCount += 1;
  }
  if (codePointCount > maxCodePoints) {
    return `longer than ${maxCodePoints} code points`;
  }
  return null;
}

export function parseDisplayName(value: string): DomainResult<DisplayName> {
  if (value.length === 0) {
    return err("invalidDisplayName", "empty");
  }
  if (WHITESPACE_ONLY_PATTERN.test(value)) {
    return err("invalidDisplayName", "whitespace only");
  }
  const violation = findCodePointViolation(value);
  if (violation !== null) {
    return err("invalidDisplayName", violation);
  }
  return ok(value as DisplayName);
}
