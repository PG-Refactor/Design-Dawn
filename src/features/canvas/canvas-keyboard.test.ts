import { describe, expect, it } from "vitest";
import { isEditableTarget, keyCommandOf } from "./canvas-keyboard";

const NO_MODIFIERS = { ctrlKey: false, metaKey: false, shiftKey: false };

describe("keyCommandOf", () => {
  it("maps Delete and Backspace to deleting the selection", () => {
    expect(keyCommandOf({ key: "Delete", ...NO_MODIFIERS })).toBe(
      "deleteSelection",
    );
    expect(keyCommandOf({ key: "Backspace", ...NO_MODIFIERS })).toBe(
      "deleteSelection",
    );
  });

  it("maps Ctrl / Cmd+Z to undo and Ctrl / Cmd+Shift+Z or Ctrl+Y to redo", () => {
    expect(keyCommandOf({ key: "z", ...NO_MODIFIERS, ctrlKey: true })).toBe(
      "undo",
    );
    expect(keyCommandOf({ key: "z", ...NO_MODIFIERS, metaKey: true })).toBe(
      "undo",
    );
    expect(
      keyCommandOf({
        key: "Z",
        ...NO_MODIFIERS,
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("redo");
    expect(
      keyCommandOf({
        key: "Z",
        ...NO_MODIFIERS,
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe("redo");
    expect(keyCommandOf({ key: "y", ...NO_MODIFIERS, ctrlKey: true })).toBe(
      "redo",
    );
  });

  it("maps Enter (without Ctrl / Meta) to starting the edit", () => {
    expect(keyCommandOf({ key: "Enter", ...NO_MODIFIERS })).toBe(
      "startEditing",
    );
    expect(
      keyCommandOf({ key: "Enter", ...NO_MODIFIERS, ctrlKey: true }),
    ).toBeNull();
    expect(
      keyCommandOf({ key: "Enter", ...NO_MODIFIERS, metaKey: true }),
    ).toBeNull();
  });

  it("maps Escape to cancelling the gesture and ignores everything else", () => {
    expect(keyCommandOf({ key: "Escape", ...NO_MODIFIERS })).toBe(
      "cancelGesture",
    );
    expect(keyCommandOf({ key: "z", ...NO_MODIFIERS })).toBeNull();
    expect(
      keyCommandOf({ key: "a", ...NO_MODIFIERS, ctrlKey: true }),
    ).toBeNull();
    expect(
      keyCommandOf({ key: "Delete", ...NO_MODIFIERS, ctrlKey: true }),
    ).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("recognises text fields and contenteditable by their element shape", () => {
    expect(
      isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isEditableTarget({ tagName: "TEXTAREA" } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isEditableTarget({
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(isEditableTarget({ tagName: "DIV" } as unknown as EventTarget)).toBe(
      false,
    );
    expect(isEditableTarget(null)).toBe(false);
  });
});
