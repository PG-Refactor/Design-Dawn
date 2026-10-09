// What the open diff does once the Git status has changed (docs/ui-design.md §13.4).
// Pure, so Stage / Unstage and, later, Commit share the rule.

import type { GitStatus } from "../../application/ports/git-gateway";
import type { GitSelection } from "../workspace/ui-state/ui-state";
import { changeSidesOf } from "./git-change-sections";

export type DiffAction =
  | { readonly kind: "none" }
  // Load the selection again (its side still has a change).
  | { readonly kind: "reload" }
  // The selected side is empty now; show the other one.
  | { readonly kind: "switch"; readonly selection: GitSelection }
  | { readonly kind: "close" };

// Conflicts have no diffable change, and an untracked file counts as an unstaged one (both
// are decided by `changeSidesOf`). Without a usable status there is nothing to show.
export function nextDiffAction(
  selection: GitSelection | null,
  status: GitStatus | null,
): DiffAction {
  if (selection === null) return { kind: "none" };
  if (status === null || status.repositoryState !== "ready") {
    return { kind: "close" };
  }
  const sides = changeSidesOf(status, selection.path);
  if (sides[selection.side] !== null) return { kind: "reload" };
  const otherSide = selection.side === "staged" ? "unstaged" : "staged";
  if (sides[otherSide] !== null) {
    return {
      kind: "switch",
      selection: { path: selection.path, side: otherSide },
    };
  }
  return { kind: "close" };
}
