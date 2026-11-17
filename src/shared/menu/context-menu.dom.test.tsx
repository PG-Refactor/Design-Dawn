// @vitest-environment jsdom
// A right-click menu closes however it is left: a press outside, the window losing focus,
// or another owner opening its own menu (only one is ever shown).
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useContextMenu } from "./context-menu";

afterEach(() => {
  cleanup();
});

function Owner({ name }: { readonly name: string }) {
  const menu = useContextMenu();
  return (
    <div>
      <button
        type="button"
        onContextMenu={(event) =>
          menu.openFromEvent(event, `${name} menu`, [
            { id: "one", label: `${name} item`, onSelect: () => {} },
          ])
        }
      >
        {name}
      </button>
      {menu.element}
    </div>
  );
}

function openOn(name: string) {
  fireEvent.contextMenu(screen.getByRole("button", { name }), {
    clientX: 10,
    clientY: 10,
  });
}

describe("a right-click menu", () => {
  it("closes on a press outside it", () => {
    render(<Owner name="First" />);
    openOn("First");
    expect(screen.getByRole("menu", { name: "First menu" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open on a press inside it", () => {
    render(<Owner name="First" />);
    openOn("First");
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "First item" }));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("closes when the window loses focus", () => {
    render(<Owner name="First" />);
    openOn("First");
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when another owner opens its menu", () => {
    render(
      <>
        <Owner name="First" />
        <Owner name="Second" />
      </>,
    );
    openOn("First");
    openOn("Second");
    expect(screen.queryByRole("menu", { name: "First menu" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Second menu" })).toBeTruthy();
  });
});
