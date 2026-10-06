// Test-only fixtures shared by Domain and application tests.

import { type Block, parseBlock } from "../block/block";
import type { BlockType } from "../block/block-type";
import { parseSheet, type Sheet } from "../sheet/sheet";
import {
  type BlockId,
  parseBlockId,
  parseDocumentId,
  parseProjectId,
  parseSheetId,
} from "./entity-id";
import { unwrap } from "./test-support";

export const PROJECT_ID = unwrap(
  parseProjectId("01928f3a-5b6c-7d8e-9f01-23456789abcd"),
);
export const DOCUMENT_ID = unwrap(
  parseDocumentId("01928f3a-6c7d-7e8f-a012-3456789abcde"),
);
export const SHEET_ID = unwrap(
  parseSheetId("01928f3a-7d8e-7f90-b123-456789abcdef"),
);
export const OTHER_SHEET_ID = unwrap(
  parseSheetId("01928f3a-7d8e-7f90-b123-456789abcd00"),
);

export function blockIdOf(counter: number): BlockId {
  return unwrap(
    parseBlockId(
      `01928f3a-8e9f-7a01-8234-${counter.toString(16).padStart(12, "0")}`,
    ),
  );
}

export function makeBlockAt(
  counter: number,
  x = 0,
  y = 0,
  blockType: BlockType = "markdown",
): Block {
  return unwrap(
    parseBlock({
      blockId: blockIdOf(counter),
      blockType,
      position: { x, y },
      size: { width: 100, height: 50 },
      contentPath: `sheets/s/blocks/${blockType}-${counter}.md`,
    }),
  );
}

export function makeSheetWith(
  sheetId: string,
  blocks: readonly Block[],
): Sheet {
  return unwrap(
    parseSheet({ schemaVersion: 1, sheetId, name: "Sheet", blocks }),
  );
}
