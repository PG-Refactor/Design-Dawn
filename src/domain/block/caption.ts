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

// Where a caption is shown relative to its figure. Below is the default and is not
// written to the file (a Block without `captionPosition` has its caption below).
export const CAPTION_POSITIONS = ["below", "above"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export const DEFAULT_CAPTION_POSITION: CaptionPosition = "below";

export function parseCaptionPosition(
  value: string,
): DomainResult<CaptionPosition> {
  const position = CAPTION_POSITIONS.find((candidate) => candidate === value);
  return position === undefined
    ? err("invalidCaption", `unknown caption position: ${value}`)
    : ok(position);
}

// A figure's caption as one value: its text and where it is shown.
export interface FigureCaption {
  readonly text: Caption;
  readonly position: CaptionPosition;
}

// The caption of a Block as one value; null when it has none.
export interface CaptionFields {
  readonly caption?: Caption;
  readonly captionPosition?: CaptionPosition;
}

// Only the caption keys of a Block (or of a copy of one), for carrying them over.
export function captionFieldsOf(source: CaptionFields): CaptionFields {
  return {
    ...(source.caption === undefined ? {} : { caption: source.caption }),
    ...(source.captionPosition === undefined
      ? {}
      : { captionPosition: source.captionPosition }),
  };
}

export function figureCaptionOf(block: CaptionFields): FigureCaption | null {
  return block.caption === undefined
    ? null
    : {
        text: block.caption,
        position: block.captionPosition ?? DEFAULT_CAPTION_POSITION,
      };
}

export function sameFigureCaption(
  first: FigureCaption | null,
  second: FigureCaption | null,
): boolean {
  return (
    first === second ||
    (first !== null &&
      second !== null &&
      first.text === second.text &&
      first.position === second.position)
  );
}
