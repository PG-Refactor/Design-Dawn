// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import {
  blockOption,
  renderOpenedCanvas,
  sourceBox,
} from "../markdown/test-support/markdown-harness";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

const MESSAGES = WORKSPACE_MESSAGES.ja;

afterEach(() => {
  cleanup();
});

const TEXTS = MESSAGES.dialogs.confirmUnsavedClose;
const TOKEN = "subscription-token";
const WRITE_METHODS = [
  "saveProject",
  "saveDocument",
  "saveSheet",
  "writeBlockContent",
] as const;

// Auto-save off, a Markdown block being edited with text that is not committed yet.
async function editingWithAutoSaveOff() {
  const rendered = await renderOpenedCanvas();
  await act(async () => {
    await rendered.shell.autoSaveController.setEnabled(false);
  });
  const path = rendered.canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
  const original = rendered.shell.gateway.files.get(path);
  fireEvent.doubleClick(blockOption(0));
  const box = sourceBox() as HTMLTextAreaElement;
  await rendered.shell.user.clear(box);
  await rendered.shell.user.click(box);
  await rendered.shell.user.paste("# Draft that must not be saved");
  rendered.shell.gateway.clearCalls();
  return { ...rendered, path, original };
}

describe("close confirmation with auto-save off", () => {
  it("shows the three choices, with 保存せずに閉じる in the destructive style", async () => {
    const { shell } = await editingWithAutoSaveOff();
    await shell.user.click(
      screen.getByRole("button", {
        name: MESSAGES.closeTabLabel("Document A"),
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(TEXTS.body)).toBeTruthy();
    const buttons = within(dialog)
      .getAllByRole("button")
      .map((button) => [button.textContent, button.className]);
    expect(buttons).toEqual([
      [MESSAGES.dialogs.cancel, "button"],
      [TEXTS.discard, "button button--danger"],
      [TEXTS.save, "button button--primary"],
    ]);
  });

  it("closes the tab on 保存せずに閉じる without writing, committing or reporting anything", async () => {
    const { shell, path, original } = await editingWithAutoSaveOff();
    await shell.user.click(
      screen.getByRole("button", {
        name: MESSAGES.closeTabLabel("Document A"),
      }),
    );
    await shell.user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: TEXTS.discard,
      }),
    );
    await act(settle);

    expect(screen.queryByRole("tab", { name: /Document A/ })).toBeNull();
    expect(shell.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(shell.gateway.methods("closeDocument")).toHaveLength(1);
    expect(shell.gateway.files.get(path)).toBe(original);
    expect(shell.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("does not commit a pending draft when the editor unmounts after 保存せずに閉じる", async () => {
    const { shell, path, original } = await editingWithAutoSaveOff();
    // No pointer interaction, so the editor keeps focus (like closing from the keyboard)
    // and the draft is still uncommitted when the question is answered.
    expect(shell.draftRegistry.hasPendingFor([DOCUMENT_A])).toBe(true);
    await act(async () => {
      await shell.actions.closeDocument(DOCUMENT_A);
      await shell.actions.answerUnsavedClose("discard");
      await settle();
    });

    expect(screen.queryByRole("tab", { name: /Document A/ })).toBeNull();
    expect(shell.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(shell.gateway.files.get(path)).toBe(original);
    expect(shell.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("keeps everything on キャンセル", async () => {
    const { shell } = await editingWithAutoSaveOff();
    await shell.user.click(
      screen.getByRole("button", {
        name: MESSAGES.closeTabLabel("Document A"),
      }),
    );
    await shell.user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: MESSAGES.dialogs.cancel,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: /Document A/ })).toBeTruthy();
    expect(shell.gateway.calls).toEqual([]);
  });

  it("asks before closing the window and confirms without saving on 保存せずに閉じる", async () => {
    const { shell } = await editingWithAutoSaveOff();
    await act(async () => {
      shell.closeRequestSource.emit({ subscriptionToken: TOKEN });
      await settle();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(shell.closeRequestSource.confirmedTokens).toEqual([]);

    // A second request while the question is open is ignored.
    await act(async () => {
      shell.closeRequestSource.emit({ subscriptionToken: TOKEN });
      await settle();
    });
    expect(shell.closeRequestSource.confirmedTokens).toEqual([]);

    await shell.user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: TEXTS.discard,
      }),
    );
    await act(settle);
    expect(shell.closeRequestSource.confirmedTokens).toEqual([TOKEN]);
    expect(shell.gateway.methods(...WRITE_METHODS)).toEqual([]);
  });

  it("asks again after a cancelled window close request", async () => {
    const { shell } = await editingWithAutoSaveOff();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => {
        shell.closeRequestSource.emit({ subscriptionToken: TOKEN });
        await settle();
      });
      await shell.user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: MESSAGES.dialogs.cancel,
        }),
      );
    }
    expect(shell.closeRequestSource.confirmedTokens).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
