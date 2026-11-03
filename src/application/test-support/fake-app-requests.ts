// Fake app request source: tests deliver requests and read the recorded acknowledgements.
// Not imported by production code.

import type {
  AppRequestSource,
  OpenDocumentRequest,
  ProjectFilesNotice,
  SettingsChange,
  WindowEvent,
} from "../ports/app-request-source";
import { type OperationResult, operationOk } from "../ports/operation-error";

export interface FakeAppRequestSource extends AppRequestSource {
  emit(request: OpenDocumentRequest): void;
  emitSettings(change: SettingsChange): void;
  emitProjectFiles(notice: ProjectFilesNotice): void;
  emitWindowEvent(event: WindowEvent): void;
  projectFilesListenerCount(): number;
  settingsListenerCount(): number;
  // Request ids passed to `acknowledgeOpenRequest`, in call order.
  readonly acknowledgedIds: string[];
  setAcknowledgeResult(result: OperationResult<void>): void;
  listenerCount(): number;
}

export function createFakeAppRequestSource(): FakeAppRequestSource {
  const listeners = new Set<(request: OpenDocumentRequest) => void>();
  const settingsListeners = new Set<(change: SettingsChange) => void>();
  const projectFilesListeners = new Set<(notice: ProjectFilesNotice) => void>();
  const windowListeners = new Set<(event: WindowEvent) => void>();
  const acknowledgedIds: string[] = [];
  let acknowledgeResult: OperationResult<void> = operationOk(undefined);
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeSettings(listener) {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    },
    subscribeProjectFiles(listener) {
      projectFilesListeners.add(listener);
      return () => projectFilesListeners.delete(listener);
    },
    subscribeWindowEvents(listener) {
      windowListeners.add(listener);
      return () => windowListeners.delete(listener);
    },
    emitWindowEvent(event) {
      for (const listener of [...windowListeners]) listener(event);
    },
    emitProjectFiles(notice) {
      for (const listener of [...projectFilesListeners]) listener(notice);
    },
    projectFilesListenerCount: () => projectFilesListeners.size,
    emitSettings(change) {
      for (const listener of [...settingsListeners]) listener(change);
    },
    settingsListenerCount: () => settingsListeners.size,
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
