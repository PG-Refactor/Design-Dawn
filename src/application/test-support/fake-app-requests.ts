// Fake app request source: tests deliver requests and read the recorded acknowledgements.
// Not imported by production code.

import type {
  AppRequestSource,
  OpenDocumentRequest,
} from "../ports/app-request-source";
import { type OperationResult, operationOk } from "../ports/operation-error";

export interface FakeAppRequestSource extends AppRequestSource {
  emit(request: OpenDocumentRequest): void;
  // Request ids passed to `acknowledgeOpenRequest`, in call order.
  readonly acknowledgedIds: string[];
  setAcknowledgeResult(result: OperationResult<void>): void;
  listenerCount(): number;
}

export function createFakeAppRequestSource(): FakeAppRequestSource {
  const listeners = new Set<(request: OpenDocumentRequest) => void>();
  const acknowledgedIds: string[] = [];
  let acknowledgeResult: OperationResult<void> = operationOk(undefined);
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    acknowledgeOpenRequest(requestId) {
      acknowledgedIds.push(requestId);
      return Promise.resolve(acknowledgeResult);
    },
    emit(request) {
      for (const listener of [...listeners]) listener(request);
    },
    acknowledgedIds,
    setAcknowledgeResult(result) {
      acknowledgeResult = result;
    },
    listenerCount: () => listeners.size,
  };
}
