// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CLEAN_GIT_STATUS } from "../../application/test-support/fake-git";
import { settle } from "../../application/test-support/fakes";
import { renderShell } from "../workspace/test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import { GIT_MESSAGES } from "./git-messages";

afterEach(cleanup);

const TEXTS = GIT_MESSAGES.ja;
const LONG = "documents/a/b/c/d/e/sheets/s/sheet.json";

async function openWithLongPaths(enabled: boolean) {
  const shell = await renderShell();
  shell.gitGateway.status = {
    ...CLEAN_GIT_STATUS,
    longPaths: { files: [LONG], count: 1, enabled },
  };
  await shell.openProjectInUi();
  await shell.user.click(
    within(
      screen.getByRole("tablist", { name: "左パネルの表示切り替え" }),
    ).getByRole("tab", { name: "Git" }),
  );
  await act(settle);
  return shell;
}

describe("paths too long for Git on Windows", () => {
  it("warns with the files and a notice, and allows long paths after asking", async () => {
    const shell = await openWithLongPaths(false);
    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain(TEXTS.longPathsTitle(1));
    expect(warning.textContent).toContain(LONG);
    expect(
      screen.getByText(WORKSPACE_MESSAGES.ja.notices.longPathsFound),
    ).toBeTruthy();

    await shell.user.click(
      within(warning).getByRole("button", { name: TEXTS.enableLongPaths }),
    );
    // Asked first: nothing is changed yet.
    expect(shell.gitGateway.longPathsEnabled).toEqual([]);
    await shell.user.click(
      within(warning).getByRole("button", { name: TEXTS.enableLongPathsDo }),
    );
    await act(settle);
    expect(shell.gitGateway.longPathsEnabled).toHaveLength(1);
    // The status read afterwards allows them: no warning any more.
    expect(screen.queryByText(TEXTS.longPathsTitle(1))).toBeNull();
  });

  it("says nothing when the repository already allows long paths", async () => {
    await openWithLongPaths(true);
    expect(screen.queryByText(TEXTS.longPathsTitle(1))).toBeNull();
    expect(
      screen.queryByText(WORKSPACE_MESSAGES.ja.notices.longPathsFound),
    ).toBeNull();
  });
});
