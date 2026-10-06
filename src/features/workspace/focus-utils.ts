// Small DOM focus helpers shared by the modal and the tab / tree widgets.

// Marks the element that should receive focus when the element that had it was removed
// (for example the delete button of an entity that no longer exists).
export const FOCUS_FALLBACK_ATTRIBUTE = "data-focus-fallback";
const FOCUS_FALLBACK_SELECTOR = `[${FOCUS_FALLBACK_ATTRIBUTE}="true"]`;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ].filter((element) => element.getAttribute("aria-hidden") !== "true");
}

export function focusFallbackElement(): void {
  document.querySelector<HTMLElement>(FOCUS_FALLBACK_SELECTOR)?.focus();
}

// Returns focus to `previous` when it is still on the page, else to the fallback.
export function restoreFocus(previous: Element | null): void {
  if (previous instanceof HTMLElement && previous.isConnected) {
    previous.focus();
    return;
  }
  focusFallbackElement();
}
