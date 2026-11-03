// The link between the diagram picture and the GUI editor beside it: right-clicking the
// picture shows what the editor can do there, clicking a node selects it in the editor.
// The editor registers what it offers while it is shown; in Source view (or outside the
// editor) nothing is registered and the picture behaves as an image.

import { createContext, useContext } from "react";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import type { DiagramHit } from "./diagram-shapes";

export interface DiagramInteractionHandler {
  // The menu for a point of the diagram: on a shape (`hit`), or on the diagram itself.
  readonly entriesFor: (hit: DiagramHit | null) => readonly PopupMenuEntry[];
  // A click on a shape: select it in the editor.
  readonly pick: (hit: DiagramHit) => void;
}

export interface DiagramInteraction {
  register(handler: DiagramInteractionHandler | null): void;
  current(): DiagramInteractionHandler | null;
}

export function createDiagramInteraction(): DiagramInteraction {
  let handler: DiagramInteractionHandler | null = null;
  return {
    register(next) {
      handler = next;
    },
    current: () => handler,
  };
}

export const DiagramInteractionContext =
  createContext<DiagramInteraction | null>(null);

export function useDiagramInteraction(): DiagramInteraction | null {
  return useContext(DiagramInteractionContext);
}
