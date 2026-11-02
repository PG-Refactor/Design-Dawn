// The diagram GUI shows one add form and one list at a time. Tests reach a control the way
// a user would: the form's "+" button or the list's tab is pressed first when the control
// is not shown. Not imported by production code.

import { fireEvent, screen } from "@testing-library/react";

const HIDDEN_CONTAINER =
  ".diagram-gui__add-panel[hidden], .diagram-gui__tab-panel[hidden]";

// Opens what hides `element` (its add form or its list tab), then returns it.
export function reveal<Element extends HTMLElement>(element: Element): Element {
  const container = element.closest<HTMLElement>(HIDDEN_CONTAINER);
  if (container === null) return element;
  const opener = document.querySelector<HTMLElement>(
    `[aria-controls="${container.id}"]`,
  );
  if (opener === null) throw new Error("no control opens this part of the GUI");
  fireEvent.click(opener);
  return element;
}

type Role =
  | "textbox"
  | "combobox"
  | "button"
  | "listbox"
  | "checkbox"
  | "group";

// getByRole that also finds a control in a closed add form or another list tab, and
// shows it.
export function getShown(role: Role, name: string | RegExp): HTMLElement {
  return reveal(screen.getByRole(role, { name, hidden: true }));
}
