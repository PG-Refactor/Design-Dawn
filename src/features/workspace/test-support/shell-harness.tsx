// Renders the workspace shell over a real workspace and the fake gateway / scheduler.
// DOM tests only; not imported by production code.

import { act, render, screen, waitFor, within } from "@testing-library/react";
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

export type UserSession = ReturnType<typeof userEvent.setup>;

// A tree row, given by its accessible name or as the element itself (rows that failed to
// load have a name that includes the failure marker).
export type TreeRow = string | HTMLElement;

export const treeItemNamed = (name: string | RegExp): HTMLElement =>
  screen.getByRole("treeitem", { name });

function rowElement(row: TreeRow): HTMLElement {
  return typeof row === "string" ? treeItemNamed(row) : row;
}

// The "⋮" button of the row itself ("<name> のメニュー"). A row's own button comes
// first in document order; the ones of nested rows follow.
export function rowMenuButton(row: TreeRow): HTMLElement {
  const [own] = within(rowElement(row)).getAllByRole("button", {
    name: /のメニュー$/,
  });
  if (own === undefined) throw new Error("the row has no menu button");
  return own;
}

// Opens the row menu and returns it.
export async function openRowMenu(
  user: UserSession,
  row: TreeRow,
): Promise<HTMLElement> {
  await user.click(rowMenuButton(row));
  return screen.getByRole("menu");
}

// Opens the row menu and chooses one item.
export async function chooseRowMenuItem(
  user: UserSession,
  row: TreeRow,
  itemName: string,
): Promise<void> {
  const menu = await openRowMenu(user, row);
  await user.click(within(menu).getByRole("menuitem", { name: itemName }));
}
