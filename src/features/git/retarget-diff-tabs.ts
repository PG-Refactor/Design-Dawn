// What the open diff tabs become once the Git status has changed: `nextDiffAction` applied to every tab. Pure.

import type { GitStatus } from "../../application/ports/git-gateway";
import {
  neighbourDiffTab,
  sameSelection,
} from "../workspace/ui-state/diff-tabs";
import type { DiffTab, GitSelection } from "../workspace/ui-state/ui-state";
import { nextDiffAction } from "./next-diff-action";

export interface RetargetedDiffTabs {
  readonly tabs: readonly DiffTab[];
  // The active tab afterwards; null means the Document is shown.
  readonly active: GitSelection | null;
}

// A tab whose side has no change anymore becomes the other side; when that tab already
// exists the two merge (the result is pinned if either was). A tab with nothing left to
// show closes. When the active tab closes, its neighbour (among the tabs that are left)
// takes over, else the Document.
export function retargetDiffTabs(
  tabs: readonly DiffTab[],
  active: GitSelection | null,
  status: GitStatus | null,
): RetargetedDiffTabs {
  const result: DiffTab[] = [];
  // The resulting target of each original tab; null when it closed.
  const outcomes: (GitSelection | null)[] = [];
  for (const tab of tabs) {
    const action = nextDiffAction(tab, status);
    let target: GitSelection | null = null;
    if (action.kind === "reload" || action.kind === "none") {
      target = { path: tab.path, side: tab.side };
    } else if (action.kind === "switch") target = action.selection;
    outcomes.push(target);
    if (target === null) continue;
    const existingIndex = result.findIndex((candidate) =>
      sameSelection(candidate, target),
    );
    const existing = result[existingIndex];
    if (existing === undefined) {
      result.push({ ...target, preview: tab.preview });
    } else {
      result[existingIndex] = {
        ...existing,
        preview: existing.preview && tab.preview,
      };
    }
  }
  return { tabs: result, active: resolveActive(tabs, outcomes, active) };
}

function resolveActive(
  tabs: readonly DiffTab[],
  outcomes: readonly (GitSelection | null)[],
  active: GitSelection | null,
): GitSelection | null {
  if (active === null) return null;
  const index = tabs.findIndex((tab) => sameSelection(tab, active));
  if (index < 0) return null;
  const own = outcomes[index];
  if (own != null) return own;
  // The original order, with the closed active tab kept as the position to look from.
  const positions = tabs
    .map((_, position) => position)
    .filter((position) => position === index || outcomes[position] != null);
  const neighbour = neighbourDiffTab(
    positions.map((position) => tabs[position] as DiffTab),
    active,
  );
  if (neighbour === null) return null;
  const neighbourPosition = tabs.findIndex((tab) =>
    sameSelection(tab, neighbour),
  );
  return outcomes[neighbourPosition] ?? null;
}
