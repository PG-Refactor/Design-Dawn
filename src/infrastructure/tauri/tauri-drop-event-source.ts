import { type EventCallback, listen } from "@tauri-apps/api/event";
import type {
  DragStateEvent,
  DropEventSource,
  FilesDroppedEvent,
} from "../../application/ports/drop-event-source";
import { EVENTS } from "./event-constants";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFilesDropped(payload: unknown): FilesDroppedEvent | null {
  if (
    isRecord(payload) &&
    typeof payload.dropId === "string" &&
    typeof payload.fileCount === "number"
  ) {
    return { dropId: payload.dropId, fileCount: payload.fileCount };
  }
  return null;
}

function toDragState(payload: unknown): DragStateEvent | null {
  return isRecord(payload) && typeof payload.active === "boolean"
    ? { active: payload.active }
    : null;
}

// `listen` is asynchronous but the port's unsubscribe is not: an unsubscribe that happens
// before the registration finished must still detach the listener once it has.
function subscribe<Event>(
  eventName: string,
  decode: (payload: unknown) => Event | null,
  listener: (event: Event) => void,
): () => void {
  let unsubscribed = false;
  let detach: (() => void) | null = null;
  const handler: EventCallback<unknown> = (event) => {
    // A malformed payload can only come from a bug on the Rust side; there is nothing
    // the user could do about it, so the event is ignored rather than half-applied.
    const decoded = decode(event.payload);
    if (decoded !== null && !unsubscribed) listener(decoded);
  };
  listen(eventName, handler).then(
    (unlisten) => {
      if (unsubscribed) unlisten();
      else detach = unlisten;
    },
    (rejection: unknown) => {
      // Without the listener drops go unnoticed; surface it for developers.
      console.error(`failed to listen to ${eventName}`, rejection);
    },
  );
  return () => {
    unsubscribed = true;
    detach?.();
    detach = null;
  };
}

export function createTauriDropEventSource(): DropEventSource {
  return {
    subscribeFilesDropped: (listener) =>
      subscribe(EVENTS.filesDropped, toFilesDropped, listener),
    subscribeDragState: (listener) =>
      subscribe(EVENTS.dragState, toDragState, listener),
  };
}
