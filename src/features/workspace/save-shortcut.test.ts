import { describe, expect, it } from "vitest";
import { isSaveShortcut, type SaveShortcutEventLike } from "./save-shortcut";

const event = (
  overrides: Partial<SaveShortcutEventLike>,
): SaveShortcutEventLike => ({
  key: "s",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...overrides,
});

describe("isSaveShortcut", () => {
  it.each([
    ["Ctrl+s", { ctrlKey: true }],
    ["Ctrl+S (caps lock)", { key: "S", ctrlKey: true }],
    ["Cmd+s", { metaKey: true }],
  ])("accepts %s", (_name, overrides) => {
    expect(isSaveShortcut(event(overrides))).toBe(true);
  });

  it.each([
    ["plain s", {}],
    ["Alt+Ctrl+s", { ctrlKey: true, altKey: true }],
    ["Alt+Cmd+s", { metaKey: true, altKey: true }],
    ["Shift+Ctrl+S", { key: "S", ctrlKey: true, shiftKey: true }],
    ["Shift+Cmd+S", { key: "S", metaKey: true, shiftKey: true }],
    ["Ctrl+s while composing", { ctrlKey: true, isComposing: true }],
    ["Ctrl+other key", { key: "a", ctrlKey: true }],
  ])("rejects %s", (_name, overrides) => {
    expect(isSaveShortcut(event(overrides))).toBe(false);
  });
});
