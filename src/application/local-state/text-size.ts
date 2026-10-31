// Parsing of the UI text size setting. The values live in `config/text-size-config.ts`;
// this is the TypeScript twin of Rust's `TextSize`.

import { TEXT_SIZES, type TextSize } from "../../config/text-size-config";
import {
  type LocalStateResult,
  localStateErr,
  localStateOk,
} from "./local-state-result";

// Case-sensitive and without trimming, like the Rust parser.
export function parseTextSize(value: string): LocalStateResult<TextSize> {
  const match = TEXT_SIZES.find((candidate) => candidate === value);
  return match === undefined
    ? localStateErr(
        "invalidTextSize",
        `not a text size: ${JSON.stringify(value)}`,
      )
    : localStateOk(match);
}
