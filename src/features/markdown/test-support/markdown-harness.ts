// Shared set-up of the Markdown block DOM tests: a rendered shell with document A's first
// sheet on screen and its block contents loaded. Not imported by production code.

import { act, screen, within } from "@testing-library/react";
import { settle } from "../../../application/test-support/fakes";
import { SHEET_A1 } from "../../../application/test-support/workspace-harness";
import type { Block } from "../../../domain/block/block";
import {
  type CanvasHarness,
  seedCanvasDisk,
  withCanvasHelpers,
} from "../../canvas/test-support/canvas-harness";
import type { ActionsHarness } from "../../workspace/test-support/actions-harness";
import {
  renderShell,
  type ShellHarness,
  type ShellOptions,
} from "../../workspace/test-support/shell-harness";

export interface RenderedCanvas {
  readonly shell: ShellHarness;
  readonly canvas: CanvasHarness;
}

export async function renderOpenedCanvas(
  seed: (harness: ActionsHarness) => void = () => undefined,
  options: Pick<ShellOptions, "mermaidRenderer"> = {},
): Promise<RenderedCanvas> {
  const shell = await renderShell({
    ...options,
    seed: (harness) => {
      seedCanvasDisk(harness);
      seed(harness);
    },
  });
  await shell.openProjectInUi();
  await shell.user.click(
    within(screen.getByRole("treeitem", { name: "Document A" })).getByText(
      "Document A",
    ),
  );
  await screen.findByRole("listbox", { name: "Sheet A1" });
  await act(settle);
  return { shell, canvas: withCanvasHelpers(shell) };
}

export const canvasElement = () =>
  screen.getByRole("listbox", { name: "Sheet A1" });
export const blockOption = (index: number) =>
  screen.getAllByRole("option")[index] as HTMLElement;
export const sheetA1Blocks = (shell: ShellHarness): readonly Block[] =>
  shell.store.getState().documents.size === 0
    ? []
    : (shell.store
        .getState()
        .documents.values()
        .next()
        .value?.sheets.get(SHEET_A1)?.blocks ?? []);

export const pointer = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  button: 0,
  pointerId: 1,
});

export const sourceBox = (shortId = "00000001") =>
  screen.getByRole("textbox", { name: `Markdownソース（${shortId}）` });
export const previewOf = (shortId = "00000001") =>
  screen.getByRole("region", { name: `Markdownプレビュー（${shortId}）` });
