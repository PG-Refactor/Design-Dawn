// Renders the workspace shell over a real workspace and the fake gateway / scheduler.
// DOM tests only; not imported by production code.

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoadIssue } from "../../../application/ports/persistence-types";
import { settle } from "../../../application/test-support/fakes";
import { TEST_AUTO_SAVE_DELAY_MS } from "../../../application/test-support/session-harness";
import { WorkspaceServicesProvider } from "../workspace-services-context";
import { WorkspaceShell } from "../workspace-shell";
import {
  type ActionsHarness,
  createActionsHarness,
  seedProjectIssues,
} from "./actions-harness";

export interface ShellHarness extends ActionsHarness {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly container: HTMLElement;
  // Clicks "Projectを開く" and waits for the tree.
  openProjectInUi(): Promise<void>;
  // Lets the auto-save timer fire and waits for the save to finish.
  runAutoSave(): Promise<void>;
}

export interface ShellOptions {
  readonly projectIssues?: readonly LoadIssue[];
  // Puts data on the fake disk before the shell is rendered.
  readonly seed?: (harness: ActionsHarness) => void;
}

export async function renderShell(
  options: ShellOptions = {},
): Promise<ShellHarness> {
  const harness = createActionsHarness();
  options.seed?.(harness);
  if (options.projectIssues !== undefined) {
    await seedProjectIssues(harness, options.projectIssues);
  }
  const { container } = render(
    <WorkspaceServicesProvider services={harness.services}>
      <WorkspaceShell />
    </WorkspaceServicesProvider>,
  );
  const user = userEvent.setup();
  return {
    ...harness,
    user,
    container,
    async openProjectInUi() {
      await user.click(screen.getByRole("button", { name: "Projectを開く" }));
      await screen.findByRole("tree");
    },
    async runAutoSave() {
      await act(async () => {
        harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
        await settle();
      });
    },
  };
}

// Runs application-side work (a session command, a workspace call) inside act, so the
// resulting store updates are flushed to the DOM before the next assertion.
export async function applyOutsideUi(
  work: () => Promise<unknown>,
): Promise<void> {
  await act(async () => {
    await work();
    await settle();
  });
}

export async function waitForGone(text: string | RegExp): Promise<void> {
  await waitFor(() => {
    if (screen.queryByText(text) !== null) throw new Error("still shown");
  });
}
