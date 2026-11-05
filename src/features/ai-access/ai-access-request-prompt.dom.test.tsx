// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import type { ProjectId } from "../../domain/shared/entity-id";
import { renderShell } from "../workspace/test-support/shell-harness";
import { AI_ACCESS_MESSAGES } from "./ai-access-messages";

afterEach(cleanup);

const JA = AI_ACCESS_MESSAGES.ja;
const ORDER = "01928f3a-0000-7000-8000-000000000001" as ProjectId;
const DOCS = "01928f3a-0000-7000-8000-000000000002" as ProjectId;

function request(projectId: ProjectId, projectName: string) {
  return {
    kind: "aiAccessRequested" as const,
    projectId,
    projectName,
    folderDisplay: `/work/${projectName}`,
  };
}

describe("an AI's request for edit permission", () => {
  it("asks one question at a time, records each answer, and repeats none", async () => {
    const shell = await renderShell({ systemLanguages: ["ja"] });
    await act(async () => {
      shell.appRequestSource.emitWindowEvent(request(ORDER, "Order"));
      shell.appRequestSource.emitWindowEvent(request(ORDER, "Order"));
      shell.appRequestSource.emitWindowEvent(request(DOCS, "Docs"));
    });
    const first = screen.getByRole("dialog", { name: JA.requestTitle });
    expect(within(first).getByText(JA.requestBody("Order"))).toBeTruthy();
    // The safe answer has the focus.
    expect(document.activeElement).toBe(
      within(first).getByRole("button", { name: JA.requestDeny }),
    );
    await shell.user.click(
      within(first).getByRole("button", { name: JA.requestAllowUntilAppExits }),
    );
    await act(settle);

    const second = screen.getByRole("dialog", { name: JA.requestTitle });
    expect(within(second).getByText(JA.requestBody("Docs"))).toBeTruthy();
    await shell.user.click(
      within(second).getByRole("button", { name: JA.requestAllow }),
    );
    await act(settle);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.aiAccess.answers).toEqual([
      { projectId: ORDER, answer: "allowUntilAppExits" },
      { projectId: DOCS, answer: "allow" },
    ]);
  });

  it("takes Escape as no, and keeps the question when the answer cannot be saved", async () => {
    const shell = await renderShell({ systemLanguages: ["ja"] });
    await act(async () => {
      shell.appRequestSource.emitWindowEvent(request(ORDER, "Order"));
    });
    shell.aiAccess.failNextChange = true;
    const dialog = screen.getByRole("dialog", { name: JA.requestTitle });
    await shell.user.click(
      within(dialog).getByRole("button", { name: JA.requestAllow }),
    );
    await act(settle);
    expect(within(dialog).getByText(JA.requestFailed)).toBeTruthy();

    await shell.user.keyboard("{Escape}");
    await act(settle);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.aiAccess.answers).toEqual([
      { projectId: ORDER, answer: "deny" },
    ]);
  });
});
