// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createActionsHarness } from "../workspace/test-support/actions-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import { WorkspaceServicesProvider } from "../workspace/workspace-services-context";
import { HelpDialogs } from "./help-dialogs";

afterEach(cleanup);

const JA = WORKSPACE_MESSAGES.ja.help;

describe("HelpDialogs text loading", () => {
  it("says so when a text cannot be loaded", async () => {
    const harness = createActionsHarness({});
    render(
      <WorkspaceServicesProvider services={harness.services}>
        <HelpDialogs
          dialog="license"
          onChange={() => undefined}
          loadText={() => Promise.reject(new Error("missing"))}
        />
      </WorkspaceServicesProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe(JA.loading);
    expect((await screen.findByText(JA.loadFailed)).getAttribute("role")).toBe(
      "status",
    );
  });
});
