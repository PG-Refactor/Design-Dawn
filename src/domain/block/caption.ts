// The caption of a Block: one line of text under a figure (a diagram, an image). Same
// character rules as a display name, longer. "No caption" is the absence of one (a Block
// without a `caption`), never an empty text. Mirrors `domain/caption.rs`.

import {
  CAPTION_MAX_CODE_POINTS,
  WHITESPACE_ONLY_PATTERN,
} from "../domain-constants";
import type { Brand } from "../shared/brand";
import { findCodePointViolation } from "../shared/display-name";
import { type DomainResult, err, ok } from "../shared/domain-result";

export type Caption = Brand<string, "Caption">;

export function parseCaption(value: string): DomainResult<Caption> {
  if (value.length === 0 || WHITESPACE_ONLY_PATTERN.test(value)) {
    return err("invalidCaption", "empty or whitespace only");
  }
  const violation = findCodePointViolation(value, CAPTION_MAX_CODE_POINTS);
  if (violation !== null) return err("invalidCaption", violation);
  return ok(value as Caption);
}
