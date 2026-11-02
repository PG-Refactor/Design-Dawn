import { describe, expect, it } from "vitest";
import { placeContextMenu } from "./context-menu-placement";

const WINDOW = { width: 800, height: 600 };
const MENU = { width: 200, height: 150 };
const MARGIN = 4;

describe("placeContextMenu", () => {
  it("opens at the pointer when the menu fits", () => {
    expect(placeContextMenu({ x: 100, y: 120 }, MENU, WINDOW, MARGIN)).toEqual({
      x: 100,
      y: 120,
    });
  });

  it("flips to the left of / above the pointer near the right / bottom edge", () => {
    expect(placeContextMenu({ x: 700, y: 550 }, MENU, WINDOW, MARGIN)).toEqual({
      x: 500,
      y: 400,
    });
  });

  it("stays inside the window when it fits on neither side", () => {
    const tall = { width: 200, height: 580 };
    expect(placeContextMenu({ x: 100, y: 300 }, tall, WINDOW, MARGIN)).toEqual({
      x: 100,
      y: 16,
    });
  });

  it("keeps the margin from the left / top edge", () => {
    expect(placeContextMenu({ x: 0, y: 1 }, MENU, WINDOW, MARGIN)).toEqual({
      x: 4,
      y: 4,
    });
  });
});
