// Decides what a pointer press on the canvas starts. Pure; the component feeds it the DOM
// facts (button, whether Space is held).
//
// Plain left press: block interaction / range selection. Space + left press and the
// middle button: pan. Anything else (right button, extra buttons) is not ours.

export const POINTER_BUTTONS = {
  primary: 0,
  middle: 1,
} as const;

export type PointerDownRoute = "interact" | "pan" | "ignore";

export interface PointerDownFacts {
  readonly button: number;
  // Space is held on the focused canvas (never true while typing in an editor).
  readonly spaceHeld: boolean;
}

export function routePointerDown({
  button,
  spaceHeld,
}: PointerDownFacts): PointerDownRoute {
  if (button === POINTER_BUTTONS.middle) return "pan";
  if (button !== POINTER_BUTTONS.primary) return "ignore";
  // While Space is held a left press never selects, drags or resizes.
  return spaceHeld ? "pan" : "interact";
}
