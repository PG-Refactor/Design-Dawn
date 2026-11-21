// A row of tabs that never wraps: when there are more tabs than fit, the row scrolls across
// (as in VS Code). The mouse wheel scrolls it sideways too, and the active tab is brought
// into view whenever it changes (a tab opened, chosen from the keyboard or from the tree).

import { useEffect, useState } from "react";

const ACTIVE_TAB_SELECTOR = '[role="tab"][aria-selected="true"]';
// The whole tab (name and its close button), not only the part that is the `tab` role.
const TAB_SELECTOR = ".tab";

// Returns the ref callback for the tablist element (which may appear later, when the first
// tab does).
export function useTabStripScroll(
  activeKey: string,
): (element: HTMLDivElement | null) => void {
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);

  // A plain wheel (up / down) moves the row sideways. Registered by hand because React's
  // wheel listener is passive and could not keep the page from taking the wheel.
  useEffect(() => {
    if (strip === null) return undefined;
    const element = strip;
    function handleWheel(event: WheelEvent): void {
      const overflowing = element.scrollWidth > element.clientWidth;
      const vertical = Math.abs(event.deltaY) > Math.abs(event.deltaX);
      if (!overflowing || !vertical) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    }
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [strip]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeKey is what says the active tab changed; the tab itself is found in the DOM.
  useEffect(() => {
    const selected = strip?.querySelector(ACTIVE_TAB_SELECTOR);
    const active = selected?.closest(TAB_SELECTOR) ?? selected;
    // Not every environment lays out (tests); there, there is nothing to scroll.
    if (
      active instanceof HTMLElement &&
      typeof active.scrollIntoView === "function"
    ) {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [strip, activeKey]);

  return setStrip;
}
