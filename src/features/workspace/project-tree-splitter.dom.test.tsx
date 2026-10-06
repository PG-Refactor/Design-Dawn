// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAKE_SETTINGS_ERROR } from "../../application/test-support/fake-theme";
import { settle } from "../../application/test-support/fakes";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import { renderShell } from "./test-support/shell-harness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const { minWidthPx, maxWidthPx, defaultWidthPx, keyStepPx, largeKeyStepPx } =
  LAYOUT_CONFIG.projectTree;
const { documentAreaMinWidthPx, splitterWidthPx } = LAYOUT_CONFIG;

const separator = () => screen.getByRole("separator");
const shownWidth = () => Number(separator().getAttribute("aria-valuenow"));
const cssWidth = (container: HTMLElement) =>
  container
    .querySelector<HTMLElement>(".workspace-shell__body")
    ?.style.getPropertyValue("--project-tree-width");
const pointer = (clientX: number) => ({
  clientX,
  button: 0,
  pointerId: 1,
});

describe("project tree splitter", () => {
  it("is a focusable vertical separator with ARIA values and a label", async () => {
    await renderShell();
    const element = separator();
    expect(element.getAttribute("aria-orientation")).toBe("vertical");
    expect(element.getAttribute("aria-label")).toBe("Project Treeの幅");
    expect(element.getAttribute("aria-valuemin")).toBe(String(minWidthPx));
    expect(element.getAttribute("aria-valuemax")).toBe(String(maxWidthPx));
    expect(element.getAttribute("aria-valuenow")).toBe(String(defaultWidthPx));
    expect(element.tabIndex).toBe(0);
  });

  it("applies the restored width once the settings are loaded", async () => {
    const shell = await renderShell();
    shell.settingsGateway.storage.projectTreeWidth = 480;
    await shell.layoutSettingsController.initialize();
    await waitFor(() => expect(shownWidth()).toBe(480));
    expect(cssWidth(shell.container)).toBe("480px");
  });

  it("changes the width with the arrow keys and saves each change", async () => {
    const shell = await renderShell();
    separator().focus();
    await shell.user.keyboard("{ArrowRight}");
    await waitFor(() => expect(shownWidth()).toBe(defaultWidthPx + keyStepPx));
    await shell.user.keyboard("{ArrowLeft}{ArrowLeft}");
    await waitFor(() => expect(shownWidth()).toBe(defaultWidthPx - keyStepPx));
    expect(shell.settingsGateway.projectTreeWidthCalls).toEqual([
      defaultWidthPx + keyStepPx,
      defaultWidthPx,
      defaultWidthPx - keyStepPx,
    ]);
    expect(shell.settingsGateway.storage.projectTreeWidth).toBe(
      defaultWidthPx - keyStepPx,
    );
  });

  it("uses the larger step with Shift", async () => {
    const shell = await renderShell();
    separator().focus();
    await shell.user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await waitFor(() =>
      expect(shownWidth()).toBe(defaultWidthPx + largeKeyStepPx),
    );
  });

  it("jumps to the limits with Home and End and does not save at a limit", async () => {
    const shell = await renderShell();
    separator().focus();
    await shell.user.keyboard("{Home}");
    await waitFor(() => expect(shownWidth()).toBe(minWidthPx));
    await shell.user.keyboard("{ArrowLeft}{Home}");
    await settle();
    expect(shell.settingsGateway.projectTreeWidthCalls).toEqual([minWidthPx]);
    await shell.user.keyboard("{End}");
    await waitFor(() => expect(shownWidth()).toBe(maxWidthPx));
  });

  it("follows the pointer live and saves once on pointer up", async () => {
    const shell = await renderShell();
    const element = separator();
    fireEvent.pointerDown(element, pointer(100));
    fireEvent.pointerMove(element, pointer(150));
    expect(shownWidth()).toBe(defaultWidthPx + 50);
    expect(cssWidth(shell.container)).toBe(`${defaultWidthPx + 50}px`);
    fireEvent.pointerMove(element, pointer(180));
    expect(shownWidth()).toBe(defaultWidthPx + 80);
    expect(shell.settingsGateway.projectTreeWidthCalls).toEqual([]);

    fireEvent.pointerUp(element, pointer(180));
    await waitFor(() =>
      expect(shell.settingsGateway.projectTreeWidthCalls).toEqual([
        defaultWidthPx + 80,
      ]),
    );
    await waitFor(() =>
      expect(shell.settingsGateway.storage.projectTreeWidth).toBe(
        defaultWidthPx + 80,
      ),
    );
    expect(shownWidth()).toBe(defaultWidthPx + 80);
  });

  it("clamps the drag to the minimum and maximum", async () => {
    const shell = await renderShell();
    const element = separator();
    fireEvent.pointerDown(element, pointer(500));
    fireEvent.pointerMove(element, pointer(-5000));
    expect(shownWidth()).toBe(minWidthPx);
    fireEvent.pointerMove(element, pointer(5000));
    expect(shownWidth()).toBe(maxWidthPx);
    fireEvent.pointerUp(element, pointer(5000));
    await waitFor(() =>
      expect(shell.settingsGateway.projectTreeWidthCalls).toEqual([maxWidthPx]),
    );
  });

  it("keeps the minimum document area width when the window is narrow", async () => {
    const shell = await renderShell();
    const body = shell.container.querySelector<HTMLElement>(
      ".workspace-shell__body",
    );
    const windowWidth = 700;
    vi.spyOn(body as HTMLElement, "getBoundingClientRect").mockReturnValue({
      width: windowWidth,
    } as DOMRect);
    const element = separator();
    fireEvent.pointerDown(element, pointer(100));
    fireEvent.pointerMove(element, pointer(5000));
    expect(shownWidth()).toBe(
      windowWidth - documentAreaMinWidthPx - splitterWidthPx,
    );
  });

  it("does not save a click without movement", async () => {
    const shell = await renderShell();
    const element = separator();
    fireEvent.pointerDown(element, pointer(100));
    fireEvent.pointerUp(element, pointer(100));
    await settle();
    expect(shell.settingsGateway.projectTreeWidthCalls).toEqual([]);
  });

  it("returns to the stored width when the drag is cancelled", async () => {
    const shell = await renderShell();
    const element = separator();
    fireEvent.pointerDown(element, pointer(100));
    fireEvent.pointerMove(element, pointer(200));
    fireEvent.pointerCancel(element, pointer(200));
    expect(shownWidth()).toBe(defaultWidthPx);
    expect(shell.settingsGateway.projectTreeWidthCalls).toEqual([]);
  });

  it("ignores the secondary button", async () => {
    await renderShell();
    const element = separator();
    fireEvent.pointerDown(element, { ...pointer(100), button: 2 });
    fireEvent.pointerMove(element, pointer(200));
    expect(shownWidth()).toBe(defaultWidthPx);
  });

  it("resets to the default width on double click and saves", async () => {
    const shell = await renderShell();
    separator().focus();
    await shell.user.keyboard("{End}");
    await waitFor(() => expect(shownWidth()).toBe(maxWidthPx));
    await shell.user.dblClick(separator());
    await waitFor(() => expect(shownWidth()).toBe(defaultWidthPx));
    expect(shell.settingsGateway.projectTreeWidthCalls).toEqual([
      maxWidthPx,
      defaultWidthPx,
    ]);
  });

  it("returns to the previous width and shows a notification when saving fails", async () => {
    const shell = await renderShell();
    shell.settingsGateway.failSet = FAKE_SETTINGS_ERROR;
    separator().focus();
    await shell.user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(shell.settingsGateway.projectTreeWidthCalls).toHaveLength(1),
    );
    await waitFor(() => expect(shownWidth()).toBe(defaultWidthPx));
    await shell.user.click(screen.getByRole("button", { name: /エラー/ }));
    expect(
      await screen.findByText(/Project Treeの幅を保存できませんでした/),
    ).toBeTruthy();
  });
});
