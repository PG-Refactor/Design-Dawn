import { describe, expect, it } from "vitest";
import {
  isEditableTarget,
  isPanModifierKey,
  keyCommandOf,
} from "./canvas-keyboard";

const NO_MODIFIERS = { ctrlKey: false, metaKey: false, shiftKey: false };

describe("clipboard and z-order shortcuts", () => {
  const withModifier = { ...NO_MODIFIERS, ctrlKey: true };

  it("maps Ctrl / Cmd + C, X, V, D", () => {
    expect(keyCommandOf({ key: "c", ...withModifier })).toBe("copy");
    expect(keyCommandOf({ key: "x", ...withModifier })).toBe("cut");
    expect(keyCommandOf({ key: "v", ...withModifier })).toBe("paste");
    expect(keyCommandOf({ key: "d", ...withModifier })).toBe("duplicate");
    expect(keyCommandOf({ key: "c", ...NO_MODIFIERS, metaKey: true })).toBe(
      "copy",
    );
  });

  it("ignores the letters without a modifier and the Shift variants", () => {
    expect(keyCommandOf({ key: "c", ...NO_MODIFIERS })).toBeNull();
    expect(
      keyCommandOf({ key: "V", ...withModifier, shiftKey: true }),
    ).toBeNull();
  });

  it("maps the bracket characters, with Shift for front / back", () => {
    expect(
      keyCommandOf({ key: "]", code: "BracketRight", ...withModifier }),
    ).toBe("bringForward");
    expect(
      keyCommandOf({ key: "[", code: "BracketLeft", ...withModifier }),
    ).toBe("sendBackward");
    // With Shift the produced character becomes "}" / "{" (US and JIS alike).
    expect(
      keyCommandOf({
        key: "}",
        code: "BracketRight",
        ...withModifier,
        shiftKey: true,
      }),
    ).toBe("bringToFront");
    expect(
      keyCommandOf({
        key: "{",
        code: "BracketLeft",
        ...withModifier,
        shiftKey: true,
      }),
    ).toBe("sendToBack");
  });

  it("follows the printed character on a Japanese (JIS) layout, not the key position", () => {
    // JIS: the key printed "[" sits where US "]" is (code BracketRight), and the key
    // printed "]" sits where US "\\" is (code Backslash).
    expect(
      keyCommandOf({ key: "[", code: "BracketRight", ...withModifier }),
    ).toBe("sendBackward");
    expect(keyCommandOf({ key: "]", code: "Backslash", ...withModifier })).toBe(
      "bringForward",
    );
    expect(
      keyCommandOf({
        key: "}",
        code: "Backslash",
        ...withModifier,
        shiftKey: true,
      }),
    ).toBe("bringToFront");
  });

  it("does not react to the brackets without a modifier", () => {
    expect(
      keyCommandOf({ key: "]", code: "BracketRight", ...NO_MODIFIERS }),
    ).toBeNull();
  });
});

describe("isPanModifierKey", () => {
  it("recognises Space by code or key", () => {
    expect(isPanModifierKey({ key: " ", code: "Space" })).toBe(true);
    expect(isPanModifierKey({ key: " " })).toBe(true);
    expect(isPanModifierKey({ key: "a", code: "KeyA" })).toBe(false);
  });
});

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
