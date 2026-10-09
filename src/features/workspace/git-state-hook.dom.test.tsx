// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CLEAN_GIT_STATUS } from "../../application/test-support/fake-git";
import { settle } from "../../application/test-support/fakes";
import { createActionsHarness } from "./test-support/actions-harness";
import { useGitState } from "./workspace-hooks";
import { WorkspaceServicesProvider } from "./workspace-services-context";

afterEach(cleanup);

function GitProbe() {
  const fileCount = useGitState((git) => git.status?.files.length ?? null);
  const statusError = useGitState((git) => git.statusError);
  return (
    <p data-testid="probe">
      {String(fileCount)}|{String(statusError)}
    </p>
  );
}

describe("useGitState", () => {
  it("reads the Git controller state and follows its store", async () => {
    const harness = createActionsHarness();
    render(
      <WorkspaceServicesProvider services={harness.services}>
        <GitProbe />
      </WorkspaceServicesProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("null|null");

    harness.gitGateway.status = {
      ...CLEAN_GIT_STATUS,
      files: [
        {
          path: "project.json",
          indexStatus: "unmodified",
          worktreeStatus: "modified",
          originalPath: null,
        },
      ],
    };
    await act(async () => {
      await harness.actions.openProjectViaDialog();
      await settle();
    });
    expect(screen.getByTestId("probe").textContent).toBe("1|null");

    harness.gitGateway.failure = { kind: "gitTimeout", detail: "slow" };
    await act(async () => {
      await harness.gitController.refreshGitStatus();
    });
    expect(screen.getByTestId("probe").textContent).toBe("null|gitTimeout");
  });
});
