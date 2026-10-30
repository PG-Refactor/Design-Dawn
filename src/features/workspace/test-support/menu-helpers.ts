// DOM test helpers for the top bar's menu bar. Not imported by production code.

import { screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

type User = ReturnType<typeof userEvent.setup>;

export type MenuItemRole = "menuitem" | "menuitemcheckbox" | "menuitemradio";

// Opens the menu titled `menuName` (when it is not open yet) and returns its element.
export async function openMenu(user: User, menuName: string) {
  const trigger = within(screen.getByRole("menubar")).getByRole("menuitem", {
    name: menuName,
  });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await user.click(trigger);
  }
  return screen.getByRole("menu", { name: menuName });
}

// Opens a menu and clicks one of its items.
export async function chooseMenuItem(
  user: User,
  menuName: string,
  itemName: string,
  role: MenuItemRole = "menuitem",
) {
  const menu = await openMenu(user, menuName);
  await user.click(within(menu).getByRole(role, { name: itemName }));
}

// An item of an open or closed menu, without choosing it (opens the menu).
export async function menuItem(
  user: User,
  menuName: string,
  itemName: string,
  role: MenuItemRole = "menuitem",
) {
  const menu = await openMenu(user, menuName);
  return within(menu).getByRole(role, { name: itemName });
}
