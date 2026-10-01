// Opens a document session wired to the fakes, collecting every published state.

import type { Block } from "../../domain/block/block";
import type { DocumentData } from "../commands/document-data";
import {
  createDocumentSession,
  type DocumentSession,
  type DocumentSessionConfig,
} from "../document-session/document-session";
import type { DocumentSessionState } from "../state/application-state";
import {
  createFakeGateway,
  createFakeScheduler,
  DOCUMENT_ID,
  type FakeGateway,
  type FakeScheduler,
  filesForBlocks,
  makeBlockAt,
  makeDocumentData,
  OTHER_SHEET_ID,
  PROJECT_ID,
  SHEET_ID,
} from "./fakes";

export const TEST_AUTO_SAVE_DELAY_MS = 100;

export interface SessionHarness {
  readonly session: DocumentSession;
  readonly gateway: FakeGateway;
  readonly scheduler: FakeScheduler;
  readonly states: DocumentSessionState[];
  readonly data: DocumentData;
}

export function defaultBlocks(): readonly Block[] {
  return [makeBlockAt(1, 0, 0), makeBlockAt(2, 10, 10), makeBlockAt(3, 20, 20)];
}

export function openSession(
  blocks: readonly Block[] = defaultBlocks(),
  config: Partial<DocumentSessionConfig> = {},
): SessionHarness {
  const data = makeDocumentData(blocks);
  const gateway = createFakeGateway(filesForBlocks(blocks));
  gateway.seedDocument({
    documentId: DOCUMENT_ID,
    sheets: [{ sheetId: SHEET_ID }, { sheetId: OTHER_SHEET_ID }],
  });
  const scheduler = createFakeScheduler();
  const states: DocumentSessionState[] = [];
  const session = createDocumentSession({
    projectId: PROJECT_ID,
    document: data.document,
    sheets: data.sheets,
    gateway,
    scheduler,
    config: {
      undoHistoryLimit: 50,
      autoSaveDelayMs: TEST_AUTO_SAVE_DELAY_MS,
      ...config,
    },
    onStateChange: (state) => states.push(state),
  });
  return { session, gateway, scheduler, states, data };
}
