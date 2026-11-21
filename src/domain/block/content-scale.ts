// How a Markdown or Mermaid Block shows its content: at a size chosen with −/+ (a percent
// of the content as written), or fitted to the Block (the largest size at which all of it is
// inside, worked out where it is shown and never stored). Each is kept on the Block only when
// it differs from the type's default, so files of Blocks nobody resized have no such keys.
// Mirrors `domain/content_scale.rs`.

import {
  CONTENT_SCALE_DEFAULT_PERCENT,
  CONTENT_SCALE_MAX_PERCENT,
  CONTENT_SCALE_MIN_PERCENT,
  CONTENT_SCALE_STEP_PERCENT,
} from "../domain-constants";
import type { Brand } from "../shared/brand";
import { type DomainResult, err, ok } from "../shared/domain-result";
import { BLOCK_TYPE_DEFINITIONS, type BlockType } from "./block-type";

export type ContentScalePercent = Brand<number, "ContentScalePercent">;

export function parseContentScalePercent(
  value: number,
): DomainResult<ContentScalePercent> {
  if (
    !Number.isInteger(value) ||
    value < CONTENT_SCALE_MIN_PERCENT ||
    value > CONTENT_SCALE_MAX_PERCENT
  ) {
    return err(
      "invalidContentScale",
      `${value} is not an integer from ${CONTENT_SCALE_MIN_PERCENT} to ${CONTENT_SCALE_MAX_PERCENT}`,
    );
  }
  return ok(value as ContentScalePercent);
}

export function isScalableBlockType(blockType: BlockType): boolean {
  return BLOCK_TYPE_DEFINITIONS[blockType].scalable;
}

// What a Block's display is, the defaults filled in.
export interface BlockDisplay {
  readonly scalePercent: ContentScalePercent;
  readonly autoFit: boolean;
}

export function blockDisplayOf(block: {
  readonly blockType: BlockType;
  readonly contentScalePercent?: ContentScalePercent;
  readonly autoFit?: boolean;
}): BlockDisplay {
  return {
    scalePercent:
      block.contentScalePercent ??
      (CONTENT_SCALE_DEFAULT_PERCENT as ContentScalePercent),
    autoFit:
      block.autoFit ?? BLOCK_TYPE_DEFINITIONS[block.blockType].fitsByDefault,
  };
}

// One press of − (direction -1) or + (+1): to the next multiple of the step, kept inside
// the bounds (so 25 goes up to 30, not 35).
export function steppedScalePercent(
  current: number,
  direction: -1 | 1,
): ContentScalePercent {
  const next =
    direction > 0
      ? Math.floor(current / CONTENT_SCALE_STEP_PERCENT + 1) *
        CONTENT_SCALE_STEP_PERCENT
      : Math.ceil(current / CONTENT_SCALE_STEP_PERCENT - 1) *
        CONTENT_SCALE_STEP_PERCENT;
  return Math.min(
    CONTENT_SCALE_MAX_PERCENT,
    Math.max(CONTENT_SCALE_MIN_PERCENT, next),
  ) as ContentScalePercent;
}

// The Block's own keys for a display: nothing for what equals the default, as in the file.
export function displayFields(
  blockType: BlockType,
  display: BlockDisplay,
): {
  readonly contentScalePercent?: ContentScalePercent;
  readonly autoFit?: boolean;
} {
  return {
    ...(display.scalePercent === CONTENT_SCALE_DEFAULT_PERCENT
      ? {}
      : { contentScalePercent: display.scalePercent }),
    ...(display.autoFit === BLOCK_TYPE_DEFINITIONS[blockType].fitsByDefault
      ? {}
      : { autoFit: display.autoFit }),
  };
}

// The display keys of a Block as stored (only what differs from the default).
export interface DisplayStoredFields {
  readonly contentScalePercent?: ContentScalePercent;
  readonly autoFit?: boolean;
}

// Only the display keys of a Block (or of a copy of one), for carrying them over.
export function displayStoredFieldsOf(
  source: DisplayStoredFields,
): DisplayStoredFields {
  return {
    ...(source.contentScalePercent === undefined
      ? {}
      : { contentScalePercent: source.contentScalePercent }),
    ...(source.autoFit === undefined ? {} : { autoFit: source.autoFit }),
  };
}
