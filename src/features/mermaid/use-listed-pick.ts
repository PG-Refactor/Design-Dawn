import { type RefObject, useEffect } from "react";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import { useDiagramInteraction } from "./diagram-interaction";
import type { DiagramHit } from "./diagram-shapes";

// The list editors (ER, state, class) and the picture beside them: a click on a shape
// selects it in the editor's lists, a right-click offers what can be done there (edit or
// delete the shape, add one), as for the other diagrams. Registered while the editor is
// shown, with the latest closures on every render.
export function useListedPick(
  pick: (hit: DiagramHit) => void,
  entriesFor: (hit: DiagramHit | null) => readonly PopupMenuEntry[] = () => [],
): void {
  const interaction = useDiagramInteraction();
  useEffect(() => {
    interaction?.register({ entriesFor, pick });
    return () => interaction?.register(null);
  });
}

// Moves the focus into the form called `title` (its first field) once it is drawn: after a
// menu item selected something, the form for it appears on the next render.
export function focusFormLater(
  root: RefObject<HTMLElement | null>,
  title: string,
): void {
  requestAnimationFrame(() => {
    const form = [...(root.current?.querySelectorAll("form") ?? [])].find(
      (candidate) => candidate.getAttribute("aria-label") === title,
    );
    form?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  });
}

// The shape's own items first, then the additions, as the other diagrams order them.
export function withAdditions(
  own: readonly PopupMenuEntry[],
  additions: readonly PopupMenuEntry[],
): readonly PopupMenuEntry[] {
  return own.length === 0
    ? additions
    : [...own, { id: "shapeSeparator", separator: true }, ...additions];
}
