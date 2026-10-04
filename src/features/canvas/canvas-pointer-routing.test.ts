import { describe, expect, it } from "vitest";
import { POINTER_BUTTONS, routePointerDown } from "./canvas-pointer-routing";

describe("routePointerDown", () => {
  it("a plain left press interacts (block interaction / range selection)", () => {
    expect(
      routePointerDown({ button: POINTER_BUTTONS.primary, spaceHeld: false }),
    ).toBe("interact");
  });

  it("Space + left press pans instead of selecting, dragging or resizing", () => {
    expect(
      routePointerDown({ button: POINTER_BUTTONS.primary, spaceHeld: true }),
    ).toBe("pan");
  });

  it("the middle button pans with or without Space", () => {
    expect(
      routePointerDown({ button: POINTER_BUTTONS.middle, spaceHeld: false }),
    ).toBe("pan");
    expect(
      routePointerDown({ button: POINTER_BUTTONS.middle, spaceHeld: true }),
    ).toBe("pan");
  });

  it("ignores the right and extra buttons", () => {
    expect(routePointerDown({ button: 2, spaceHeld: false })).toBe("ignore");
    expect(routePointerDown({ button: 3, spaceHeld: true })).toBe("ignore");
  });
});
