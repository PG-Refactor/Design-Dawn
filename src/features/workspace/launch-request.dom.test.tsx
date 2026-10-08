// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { createActionsHarness } from "./test-support/actions-harness";
import { WorkspaceServicesProvider } from "./workspace-services-context";
import { WorkspaceShell } from "./workspace-shell";

afterEach(() => {
  cleanup();
});

function renderStrict(harness: ReturnType<typeof createActionsHarness>) {
  render(
    <StrictMode>
      <WorkspaceServicesProvider services={harness.services}>
        <WorkspaceShell />
      </WorkspaceServicesProvider>
    </StrictMode>,
  );
}

describe("launch request at start-up", () => {
  it("opens the requested document once, even under StrictMode", async () => {
    const harness = createActionsHarness();
    harness.gateway.queueOpenRequest(DOCUMENT_A);

    renderStrict(harness);

    await screen.findByRole("tree");
    expect(harness.gateway.methods("takeOpenRequest")).toHaveLength(1);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_A);
  });

  it("shows a failure in the notifications", async () => {
    const harness = createActionsHarness();
    harness.gateway.failOn("takeOpenRequest", "fileNotFound");

    renderStrict(harness);

    await screen.findByText(/\.dawn を開けませんでした/);
    expect(harness.store.getState().project).toBeNull();
  });
});
