// Fake close request source: tests trigger requests and read the recorded confirmations.
// Not imported by production code.

import { type OperationResult, operationOk } from "../ports/operation-error";
import type {
  CloseDecision,
  CloseRequest,
  CloseRequestSource,
  WindowCloseScope,
} from "../ports/window-close";

export interface FakeCloseRequestSource extends CloseRequestSource {
  emit(request: CloseRequest): void;
  // Tokens passed to `confirmClose`, in call order.
  readonly confirmedTokens: string[];
  // How many times the window was brought forward.
  readonly forwardCount: () => number;
  // The result the next confirmations return (default: success).
  setConfirmResult(result: OperationResult<void>): void;
  listenerCount(): number;
  // What `scope` answers (default: the app ends, nothing unsaved elsewhere).
  setScope(scope: WindowCloseScope): void;
  // What `reportUnsaved` was told, in call order.
  readonly reportedUnsaved: boolean[];
  // Decisions passed to `closeDocumentWindows`, in call order.
  readonly closedDocumentWindows: CloseDecision[];
}

export const LAST_WINDOW_SCOPE: WindowCloseScope = {
  endsApp: true,
  documentWindowsUnsaved: false,
};

export function createFakeCloseRequestSource(): FakeCloseRequestSource {
  const listeners = new Set<(request: CloseRequest) => void>();
  const confirmedTokens: string[] = [];
  let confirmResult: OperationResult<void> = operationOk(undefined);
  let forwarded = 0;
  let scope = LAST_WINDOW_SCOPE;
  const reportedUnsaved: boolean[] = [];
  const closedDocumentWindows: CloseDecision[] = [];
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    confirmClose(subscriptionToken) {
      confirmedTokens.push(subscriptionToken);
      return Promise.resolve(confirmResult);
    },
    bringForward() {
      forwarded += 1;
      return Promise.resolve();
    },
    forwardCount: () => forwarded,
    emit(request) {
      for (const listener of [...listeners]) listener(request);
    },
    confirmedTokens,
    setConfirmResult(result) {
      confirmResult = result;
    },
    listenerCount: () => listeners.size,
    scope: () => Promise.resolve(operationOk(scope)),
    setScope(next) {
      scope = next;
    },
    reportUnsaved(unsaved) {
      reportedUnsaved.push(unsaved);
      return Promise.resolve();
    },
    reportedUnsaved,
    closeDocumentWindows(decision) {
      closedDocumentWindows.push(decision);
      return Promise.resolve();
    },
    closedDocumentWindows,
  };
}
