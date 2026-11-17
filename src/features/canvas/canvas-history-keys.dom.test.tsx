// @vitest-environment jsdom
// Ctrl+Z right after adding a block from the toolbar menu, or right after deleting the
// selected block with Delete, undoes it: the key must not be lost because the focus was on
// the menu button or on the block that went away.
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  blockOption,
  canvasElement,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const blockCount = () => screen.getAllByRole("option").length;

describe("undo right after adding or deleting", () => {
  it("undoes an add made from the + Block menu while the focus is on its button", async () => {
    const { shell } = await renderOpenedCanvas();
    const before = blockCount();
    await shell.user.click(screen.getByRole("button", { name: "+ Block" }));
    await shell.user.click(screen.getByRole("menuitem", { name: "Markdown" }));
    await act(settle);
    expect(blockCount()).toBe(before + 1);
    await shell.user.keyboard("{Control>}z{/Control}");
    await act(settle);
    expect(blockCount()).toBe(before);
  });

  it("keeps the focus on the canvas after Delete, so Ctrl+Z brings the block back", async () => {
    const { shell } = await renderOpenedCanvas();
    const before = blockCount();
    fireEvent.pointerDown(blockOption(0), { button: 0 });
    fireEvent.pointerUp(blockOption(0), { button: 0 });
    await act(settle);
    await shell.user.keyboard("{Delete}");
    await act(settle);
    expect(blockCount()).toBe(before - 1);
    expect(document.activeElement).toBe(canvasElement());
    await shell.user.keyboard("{Control>}z{/Control}");
    await act(settle);
    expect(blockCount()).toBe(before);
  });

  it("undoes when nothing has the focus", async () => {
    const { shell } = await renderOpenedCanvas();
    const before = blockCount();
    await shell.user.click(screen.getByRole("button", { name: "+ Block" }));
    await shell.user.click(screen.getByRole("menuitem", { name: "Markdown" }));
    await act(settle);
    (document.activeElement as HTMLElement | null)?.blur();
    await shell.user.keyboard("{Control>}z{/Control}");
    await act(settle);
    expect(blockCount()).toBe(before);
  });
});
