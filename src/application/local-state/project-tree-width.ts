// Width of the Project Tree panel in CSS pixels (docs/architecture.md §6.2.2). Same rule as
// Rust (`application/local_state/layout.rs`): an integer within the configured limits.

import { LAYOUT_CONFIG } from "../../config/layout-config";
import {
  type LocalStateResult,
  localStateErr,
  localStateOk,
} from "./local-state-result";

const { minWidthPx, maxWidthPx } = LAYOUT_CONFIG.projectTree;

export function parseProjectTreeWidth(value: number): LocalStateResult<number> {
  if (!Number.isInteger(value) || value < minWidthPx || value > maxWidthPx) {
    return localStateErr(
      "invalidProjectTreeWidth",
      `project tree width ${value} must be an integer within [${minWidthPx}, ${maxWidthPx}]`,
    );
  }
  return localStateOk(value);
}

// Rounds first so a pointer position such as 300.4 becomes a storable width.
export function clampProjectTreeWidth(
  value: number,
  maxWidthPxLimit: number = maxWidthPx,
): number {
  const upper = Math.max(minWidthPx, Math.min(maxWidthPx, maxWidthPxLimit));
  return Math.min(upper, Math.max(minWidthPx, Math.round(value)));
}
