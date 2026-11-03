// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderShell } from "./test-support/shell-harness";
import { addOperationError } from "./ui-state/shell-ui-state";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

const JA = WORKSPACE_MESSAGES.ja;
const IO_ERROR = { kind: "ioError", detail: "disk" } as const;

afterEach(() => {
  cleanup();
});

describe("the notifications panel", () => {
  it("closes when its last notice is dismissed, with focus on the bell", async () => {
    const shell = await renderShell();
    act(() => {
      shell.uiStateStore.setState((state) =>
        addOperationError(state, "openDocument", "Document A", IO_ERROR),
      );
    });
    act(() => shell.actions.setNotificationsOpen(true));
    expect(
      screen.getByRole("region", { name: JA.notifications.panelLabel }),
    ).toBeTruthy();

    await shell.user.click(
      screen.getByRole("button", { name: JA.notifications.dismiss }),
    );

    expect(
      screen.queryByRole("region", { name: JA.notifications.panelLabel }),
    ).toBeNull();
    expect(screen.queryByText(JA.notifications.emptyPanel)).toBeNull();
    expect(document.activeElement?.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open to say there is nothing when opened empty, and Escape closes it", async () => {
    const shell = await renderShell();
    const bell = screen.getByRole("button", {
      name: JA.notificationCounts(0, 0),
    });
    await shell.user.click(bell);
    expect(screen.getByText(JA.notifications.emptyPanel)).toBeTruthy();

    await shell.user.keyboard("{Escape}");

    expect(screen.queryByText(JA.notifications.emptyPanel)).toBeNull();
    expect(document.activeElement).toBe(bell);
  });
});
