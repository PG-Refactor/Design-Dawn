// Fakes for the drop event source and the asset URL resolver. Not imported by production
// code.

import type { AssetUrlResolver } from "../ports/asset-url-resolver";
import type {
  DragStateEvent,
  DropEventSource,
  FilesDroppedEvent,
} from "../ports/drop-event-source";

export interface FakeDropEventSource extends DropEventSource {
  emitFilesDropped(event: FilesDroppedEvent): void;
  emitDragState(event: DragStateEvent): void;
  // Listeners that are subscribed right now (to assert unsubscribing).
  listenerCount(): number;
}

export function createFakeDropEventSource(): FakeDropEventSource {
  const dropListeners = new Set<(event: FilesDroppedEvent) => void>();
  const dragListeners = new Set<(event: DragStateEvent) => void>();
  return {
    subscribeFilesDropped(listener) {
      dropListeners.add(listener);
      return () => dropListeners.delete(listener);
    },
    subscribeDragState(listener) {
      dragListeners.add(listener);
      return () => dragListeners.delete(listener);
    },
    emitFilesDropped(event) {
      for (const listener of [...dropListeners]) listener(event);
    },
    emitDragState(event) {
      for (const listener of [...dragListeners]) listener(event);
    },
    listenerCount: () => dropListeners.size + dragListeners.size,
  };
}

// Readable URLs that carry the identifiers, so tests can see which asset an `<img>` shows.
export function createFakeAssetUrlResolver(): AssetUrlResolver {
  return {
    urlFor: (projectId, documentId, contentPath) =>
      `test-asset://${projectId}/${documentId}/${contentPath}`,
  };
}
