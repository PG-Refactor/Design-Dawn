// Fake close request source: tests trigger requests and read the recorded confirmations.
// Not imported by production code.

import { type OperationResult, operationOk } from "../ports/operation-error";
import type { CloseRequest, CloseRequestSource } from "../ports/window-close";

export interface FakeCloseRequestSource extends CloseRequestSource {
  emit(request: CloseRequest): void;
  // Tokens passed to `confirmClose`, in call order.
  readonly confirmedTokens: string[];
  // The result the next confirmations return (default: success).
  setConfirmResult(result: OperationResult<void>): void;
  listenerCount(): number;
}

export function createFakeCloseRequestSource(): FakeCloseRequestSource {
  const listeners = new Set<(request: CloseRequest) => void>();
  const confirmedTokens: string[] = [];
  let confirmResult: OperationResult<void> = operationOk(undefined);
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    confirmClose(subscriptionToken) {
      confirmedTokens.push(subscriptionToken);
      return Promise.resolve(confirmResult);
    },
    emit(request) {
      for (const listener of [...listeners]) listener(request);
    },
    confirmedTokens,
    setConfirmResult(result) {
      confirmResult = result;
    },
    listenerCount: () => listeners.size,
  };
}
