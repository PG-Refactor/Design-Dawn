// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { AI_ACCESS_CONFIG } from "../../config/ai-access-config";
import type { ContentPath } from "../../domain/block/content-path";
import type { ProjectId } from "../../domain/shared/entity-id";
import { sheetA1Blocks } from "../markdown/test-support/markdown-harness";
import { renderShell } from "../workspace/test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import { AI_ACCESS_MESSAGES } from "./ai-access-messages";

afterEach(cleanup);

const TEXTS = AI_ACCESS_MESSAGES.ja.imageRequest;

function request(requestId: string) {
  return {
    kind: "aiImageRequested" as const,
    requestId,
    projectId: "01928f3a-0000-7000-8000-000000000001" as ProjectId,
    documentId: DOCUMENT_A,
    sheetId: SHEET_A1,
    fileName: "flow.png",
    x: 40,
    y: 60,
    caption: "Order flow",
  };
}

describe("an AI's request to add an image", () => {
  it("shows the picture and adds the block only when allowed", async () => {
    const shell = await renderShell({ systemLanguages: ["ja"] });
    await shell.openProjectInUi();
    shell.aiAccess.imageToImport = {
      contentPath: "assets/flow.png" as ContentPath,
      naturalWidth: 100,
      naturalHeight: 50,
      initialWidth: 100,
      initialHeight: 50,
      blockType: "image",
    };
    await act(async () => {
      shell.appRequestSource.emitWindowEvent(request("req-1"));
    });
    await act(settle);
    const dialog = screen.getByRole("dialog", { name: TEXTS.title });
    expect(
      within(dialog).getByRole("img", { name: TEXTS.previewLabel }),
    ).toBeTruthy();
    const before = sheetA1Blocks(shell).length;
    await shell.user.click(
      within(dialog).getByRole("button", { name: TEXTS.allow }),
    );
    await act(settle);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.aiAccess.imageAnswers).toEqual([
      { requestId: "req-1", allow: true },
    ]);
    const blocks = sheetA1Blocks(shell);
    expect(blocks).toHaveLength(before + 1);
    expect(blocks.at(-1)).toMatchObject({
      blockType: "image",
      position: { x: 40, y: 60 },
      caption: "Order flow",
    });
  });

  it("adds nothing when refused", async () => {
    const shell = await renderShell({ systemLanguages: ["ja"] });
    await shell.openProjectInUi();
    await act(async () => {
      shell.appRequestSource.emitWindowEvent(request("req-2"));
    });
    await act(settle);
    const dialog = screen.getByRole("dialog", { name: TEXTS.title });
    await shell.user.click(
      within(dialog).getByRole("button", { name: TEXTS.deny }),
    );
    await act(settle);
    expect(shell.aiAccess.imageAnswers).toEqual([
      { requestId: "req-2", allow: false },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the question when the request expires, and says so", async () => {
    const shell = await renderShell({ systemLanguages: ["ja"] });
    await shell.openProjectInUi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await act(async () => {
        shell.appRequestSource.emitWindowEvent(request("req-3"));
      });
      await act(settle);
      expect(screen.getByRole("dialog", { name: TEXTS.title })).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(AI_ACCESS_CONFIG.requestLifetimeMs + 1);
        await settle();
      });
      expect(screen.queryByRole("dialog", { name: TEXTS.title })).toBeNull();
      expect(
        screen.getByText(WORKSPACE_MESSAGES.ja.notices.aiImageRequestExpired),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells that a late Add found the request expired", async () => {
    const shell = await renderShell({ systemLanguages: ["ja"] });
    await shell.openProjectInUi();
    shell.aiAccess.goneImageRequests.push("req-4");
    await act(async () => {
      shell.appRequestSource.emitWindowEvent(request("req-4"));
    });
    await act(settle);
    const before = sheetA1Blocks(shell).length;
    await shell.user.click(
      within(screen.getByRole("dialog", { name: TEXTS.title })).getByRole(
        "button",
        { name: TEXTS.allow },
      ),
    );
    await act(settle);
    expect(screen.queryByRole("dialog", { name: TEXTS.title })).toBeNull();
    expect(
      screen.getByText(WORKSPACE_MESSAGES.ja.notices.aiImageRequestExpired),
    ).toBeTruthy();
    expect(sheetA1Blocks(shell)).toHaveLength(before);
  });
});
