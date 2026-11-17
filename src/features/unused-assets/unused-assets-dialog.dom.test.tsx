// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { parseBlock } from "../../domain/block/block";
import { blockIdOf } from "../../domain/shared/test-fixtures";
import { unwrap } from "../../domain/shared/test-support";
import { seededBlocks } from "../canvas/test-support/canvas-harness";
import {
  blockOption,
  canvasElement,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import { seedSheetBlocks } from "../workspace/test-support/actions-harness";
import { openUnusedAssets } from "./unused-assets-dialog";
import { UNUSED_ASSETS_MESSAGES } from "./unused-assets-messages";

const TEXTS = UNUSED_ASSETS_MESSAGES.ja;
const PHOTO_PATH = "assets/photo.png";
const STRAY_PATH = "assets/stray.png";
const PHOTO_COUNTER = 90;
// The three seeded markdown blocks, then the image block.
const PHOTO_INDEX = 3;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderWithPhoto() {
  const rendered = await renderOpenedCanvas((harness) => {
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, [
      ...seededBlocks(),
      unwrap(
        parseBlock({
          blockId: blockIdOf(PHOTO_COUNTER),
          blockType: "image",
          position: { x: 400, y: 300 },
          size: { width: 100, height: 50 },
          contentPath: PHOTO_PATH,
        }),
      ),
    ]);
  });
  rendered.shell.gateway.seedAsset(DOCUMENT_A, PHOTO_PATH);
  rendered.shell.gateway.seedAsset(DOCUMENT_A, STRAY_PATH);
  return rendered;
}

async function openDialog() {
  await act(async () => {
    openUnusedAssets(DOCUMENT_A);
    await settle();
  });
  return screen.getByRole("dialog");
}

describe("unused images", () => {
  it("lists only the images nothing uses and deletes the chosen ones", async () => {
    const { shell } = await renderWithPhoto();
    const dialog = await openDialog();
    const list = within(dialog).getByRole("list", { name: TEXTS.listLabel });
    expect(list.textContent).toContain(STRAY_PATH);
    expect(list.textContent).not.toContain(PHOTO_PATH);
    await shell.user.click(
      within(dialog).getByRole("button", { name: TEXTS.deleteChosen(1) }),
    );
    await act(settle);
    expect(within(dialog).getByRole("status").textContent).toBe(
      TEXTS.deleted(1),
    );
    expect(shell.gateway.hasAsset(DOCUMENT_A, STRAY_PATH)).toBe(false);
    expect(shell.gateway.hasAsset(DOCUMENT_A, PHOTO_PATH)).toBe(true);
  });

  it("leaves out an image Undo may bring back", async () => {
    const { canvas } = await renderWithPhoto();
    const pointer = { clientX: 410, clientY: 310, button: 0, pointerId: 1 };
    fireEvent.pointerDown(blockOption(PHOTO_INDEX), pointer);
    fireEvent.pointerUp(canvasElement(), pointer);
    await act(async () => {
      fireEvent.keyDown(canvasElement(), { key: "Delete" });
      await settle();
      await canvas.session.flush();
    });
    expect(canvas.session.getState().history.canUndo).toBe(true);
    const dialog = await openDialog();
    const list = within(dialog).getByRole("list", { name: TEXTS.listLabel });
    expect(list.textContent).toContain(STRAY_PATH);
    expect(list.textContent).not.toContain(PHOTO_PATH);
    expect(dialog.textContent).toContain(TEXTS.heldByHistory(1));
  });
});
