// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuBar } from "./menu-bar";
import type { MenuDefinition } from "./menu-bar-types";

afterEach(cleanup);

function setup(overrides: { readonly disabledSave?: boolean } = {}) {
  const onOpen = vi.fn();
  const onSave = vi.fn();
  const onToggle = vi.fn();
  const onTheme = vi.fn();
  const menus: MenuDefinition[] = [
    {
      id: "file",
      label: "File",
      entries: [
        { kind: "item", id: "open", label: "Open", onSelect: onOpen },
        {
          kind: "item",
          id: "save",
          label: "Save",
          shortcutHint: "Ctrl+S",
          shortcutKeys: "Control+S",
          disabled: overrides.disabledSave === true,
          onSelect: onSave,
        },
        { kind: "separator", id: "sep" },
        {
          kind: "checkbox",
          id: "auto",
          label: "Auto",
          checked: true,
          onSelect: onToggle,
        },
      ],
    },
    {
      id: "view",
      label: "View",
      entries: [
        {
          kind: "radioGroup",
          id: "theme",
          label: "Theme",
          value: "light",
          options: [
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ],
          onSelect: onTheme,
        },
      ],
    },
  ];
  render(
    <div>
      <button type="button">before</button>
      <MenuBar label="Menu" menus={menus} />
      <button type="button">outside</button>
    </div>,
  );
  return {
    user: userEvent.setup(),
    onOpen,
    onSave,
    onToggle,
    onTheme,
    file: () => screen.getByRole("menuitem", { name: "File" }),
    view: () => screen.getByRole("menuitem", { name: "View" }),
  };
}

describe("MenuBar roles and attributes", () => {
  it("exposes a menubar of collapsed titles with a single tab stop", () => {
    const { file, view } = setup();
    expect(screen.getByRole("menubar", { name: "Menu" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    for (const title of [file(), view()]) {
      expect(title.getAttribute("aria-haspopup")).toBe("menu");
      expect(title.getAttribute("aria-expanded")).toBe("false");
    }
    expect(file().tabIndex).toBe(0);
    expect(view().tabIndex).toBe(-1);
  });

  it("uses item, checkbox and radio roles with their checked states", async () => {
    const { user, file, view } = setup();
    await user.click(file());
    const menu = screen.getByRole("menu", { name: "File" });
    expect(file().getAttribute("aria-expanded")).toBe("true");
    expect(file().getAttribute("aria-controls")).toBe(menu.id);
    expect(within(menu).getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(
      within(menu)
        .getByRole("menuitemcheckbox", { name: "Auto" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(within(menu).getByText("Ctrl+S")).toBeTruthy();
    expect(
      within(menu)
        .getByRole("menuitem", { name: "Save" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Control+S");
    await user.hover(view());
    const group = within(screen.getByRole("menu", { name: "View" })).getByRole(
      "group",
      { name: "Theme" },
    );
    expect(
      within(group)
        .getAllByRole("menuitemradio")
        .map((item) => [item.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([
      ["Light", "true"],
      ["Dark", "false"],
    ]);
  });
});

describe("MenuBar keyboard", () => {
  it("opens with Enter, Space or ArrowDown onto the first item, ArrowUp onto the last", async () => {
    const { user, file } = setup();
    file().focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Open" }),
    );
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(file());
    expect(screen.queryByRole("menu")).toBeNull();

    await user.keyboard(" ");
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.keyboard("{Escape}{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Open" }),
    );
    await user.keyboard("{Escape}{ArrowUp}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemcheckbox", { name: "Auto" }),
    );
  });

  it("moves with arrows (wrapping), Home and End", async () => {
    const { user, file } = setup();
    file().focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Save");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Auto");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Open");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement?.textContent).toBe("Auto");
    await user.keyboard("{Home}");
    expect(document.activeElement?.textContent).toBe("Open");
    await user.keyboard("{End}");
    expect(document.activeElement?.textContent).toBe("Auto");
  });

  it("moves between menus with ArrowLeft / ArrowRight, closed or open", async () => {
    const { user, file, view } = setup();
    file().focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(view());
    expect(view().tabIndex).toBe(0);
    expect(screen.queryByRole("menu")).toBeNull();
    await user.keyboard("{ArrowLeft}{Enter}{ArrowRight}");
    expect(screen.getByRole("menu", { name: "View" })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "File" })).toBeNull();
    expect(document.activeElement?.textContent).toBe("Light");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("menu", { name: "File" })).toBeTruthy();
  });

  it("activates the focused item with Enter or Space, closes and returns the focus", async () => {
    const { user, file, onOpen, onToggle } = setup();
    file().focus();
    await user.keyboard("{Enter}{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(file());
    expect(onToggle).not.toHaveBeenCalled();
    await user.keyboard("{ArrowUp} ");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape and returns the focus to the title", async () => {
    const { user, file } = setup();
    await user.click(file());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(file());
  });

  it("closes with Tab", async () => {
    const { user, file } = setup();
    await user.click(file());
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("focuses the menubar with F10 from anywhere", async () => {
    const { user, file } = setup();
    screen.getByRole("button", { name: "outside" }).focus();
    await user.keyboard("{F10}");
    expect(document.activeElement).toBe(file());
  });
});

describe("MenuBar pointer", () => {
  it("toggles a menu by clicking its title and closes on an outside click", async () => {
    const { user, file } = setup();
    await user.click(file());
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.click(file());
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(file());
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("switches to another menu by hovering its title while one is open", async () => {
    const { user, file, view } = setup();
    await user.hover(view());
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(file());
    await user.hover(view());
    expect(screen.getByRole("menu", { name: "View" })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "File" })).toBeNull();
  });

  it("runs the action of a clicked item and closes the menu", async () => {
    const { user, file, view, onSave, onTheme } = setup();
    await user.click(file());
    await user.click(screen.getByRole("menuitem", { name: /^Save/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(view());
    await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(onTheme).toHaveBeenCalledWith("dark");
  });
});

describe("MenuBar disabled items", () => {
  it("marks the item aria-disabled, keeps it focusable and does nothing on activation", async () => {
    const { user, file, onSave } = setup({ disabledSave: true });
    await user.click(file());
    const save = screen.getByRole("menuitem", { name: /^Save/ });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(save);
    await user.keyboard("{Enter}");
    await user.click(save);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});
