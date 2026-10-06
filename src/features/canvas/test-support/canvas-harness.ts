// A workspace with document A open and blocks seeded in sheet A1, for canvas tests (node
// and DOM). Not imported by production code.

import type { DocumentSession } from "../../../application/document-session/document-session";
import {
  blockIdOf,
  makeBlockAt,
} from "../../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
  SHEET_A2,
} from "../../../application/test-support/workspace-harness";
import type { Block } from "../../../domain/block/block";
import {
  type ActionsHarness,
  createActionsHarness,
  seedSheetBlocks,
} from "../../workspace/test-support/actions-harness";

export const BLOCK_ONE = blockIdOf(1);
export const BLOCK_TWO = blockIdOf(2);
export const BLOCK_THREE = blockIdOf(3);

// makeBlockAt gives every block the size 100 x 50.
export function seededBlocks(): readonly Block[] {
  return [
    makeBlockAt(1, 10, 20),
    makeBlockAt(2, 300, 40),
    makeBlockAt(3, 0, 200),
  ];
}

export const SHEET_A2_BLOCKS: readonly Block[] = [makeBlockAt(11, 5, 5)];

export interface CanvasHarness extends ActionsHarness {
  readonly session: DocumentSession;
  blocksOfSheetA1(): readonly Block[];
  // Number of undo steps available (undoes and redoes everything to count them).
  undoDepth(): Promise<number>;
}

// Seeds before the project is opened, so the document loads with its blocks.
export function seedCanvasDisk(harness: ActionsHarness): void {
  seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, seededBlocks());
  seedSheetBlocks(harness, DOCUMENT_A, SHEET_A2, SHEET_A2_BLOCKS);
}

export function createCanvasHarness(): CanvasHarness {
  const harness = createActionsHarness();
  seedCanvasDisk(harness);
  return withCanvasHelpers(harness);
}

export function withCanvasHelpers(harness: ActionsHarness): CanvasHarness {
  return {
    ...harness,
    get session(): DocumentSession {
      const session = harness.workspace.getDocumentSession(DOCUMENT_A);
      if (session === null) throw new Error("document A must be open");
      return session;
    },
    blocksOfSheetA1: () =>
      harness.store.getState().documents.get(DOCUMENT_A)?.sheets.get(SHEET_A1)
        ?.blocks ?? [],
    async undoDepth() {
      const session = harness.workspace.getDocumentSession(DOCUMENT_A);
      if (session === null) throw new Error("document A must be open");
      let depth = 0;
      while (session.getState().history.canUndo) {
        await session.undo();
        depth += 1;
      }
      for (let step = 0; step < depth; step += 1) await session.redo();
      return depth;
    },
  };
}

export async function openedCanvasHarness(): Promise<CanvasHarness> {
  const harness = createCanvasHarness();
  const project = await harness.actions.openProjectViaDialog();
  if (!project.ok) throw new Error("project must open");
  const document = await harness.actions.openDocument(DOCUMENT_A);
  if (!document.ok) throw new Error("document must open");
  harness.gateway.clearCalls();
  return harness;
}
