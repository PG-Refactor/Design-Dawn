// The diagram GUI shows one add form and one list at a time. Tests reach a control the way
// a user would: the form's "+" button or the list's tab is pressed first when the control
// is not shown. Not imported by production code.

import { fireEvent, screen } from "@testing-library/react";

const HIDDEN_CONTAINER = [
  ".diagram-gui__add-panel[hidden]",
  ".diagram-gui__tab-panel[hidden]",
  ".diagram-gui__disclosure-body[hidden]",
].join(", ");

// Opens what hides `element` (its add form, its list tab, the folded lists or settings),
// outermost first, then returns it.
export function reveal<Element extends HTMLElement>(element: Element): Element {
  for (;;) {
    const hidden = [] as HTMLElement[];
    for (
      let current: HTMLElement | null =
        element.closest<HTMLElement>(HIDDEN_CONTAINER);
      current !== null;
      current =
        current.parentElement?.closest<HTMLElement>(HIDDEN_CONTAINER) ?? null
    ) {
      hidden.push(current);
    }
    const outermost = hidden.at(-1);
    if (outermost === undefined) return element;
    const opener = document.querySelector<HTMLElement>(
      `[aria-controls="${outermost.id}"]`,
    );
    if (opener === null)
      throw new Error("no control opens this part of the GUI");
    fireEvent.click(opener);
  }
}

type Role =
  | "textbox"
  | "combobox"
  | "button"
  | "listbox"
  | "checkbox"
  | "group"
  | "option"
  | "tab"
  | "region";

// getByRole that also finds a control in a closed add form or another list tab, and
// shows it.
export function getShown(role: Role, name: string | RegExp): HTMLElement {
  return reveal(screen.getByRole(role, { name, hidden: true }));
}
