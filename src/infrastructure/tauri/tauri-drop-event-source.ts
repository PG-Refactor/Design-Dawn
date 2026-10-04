import { Channel } from "@tauri-apps/api/core";
import type {
  DragStateEvent,
  DropEventSource,
  FilesDroppedEvent,
} from "../../application/ports/drop-event-source";
import { COMMANDS } from "./command-constants";
import { commandOk } from "./command-error";
import { call } from "./invoke-command";

// `kind` values of the notifications Rust sends; they must match `DropNotification` in
// `src-tauri/src/commands/drag_drop.rs`.
const NOTIFICATION_KINDS = {
  dragState: "dragState",
  filesDropped: "filesDropped",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFilesDropped(
  message: Record<string, unknown>,
): FilesDroppedEvent | null {
  return typeof message.dropId === "string" &&
    typeof message.fileCount === "number"
    ? { dropId: message.dropId, fileCount: message.fileCount }
    : null;
}

function toDragState(message: Record<string, unknown>): DragStateEvent | null {
  return typeof message.active === "boolean"
    ? { active: message.active }
    : null;
}

// Drop notifications arrive on an IPC channel, not as Tauri events: Tauri's own drag-drop
// events carry absolute paths and the capability deliberately grants no `core:event`
// permission, so the Frontend cannot listen to events at all.
export function createTauriDropEventSource(): DropEventSource {
  const filesDroppedListeners = new Set<(event: FilesDroppedEvent) => void>();
  const dragStateListeners = new Set<(event: DragStateEvent) => void>();
  let channel: Channel<unknown> | null = null;

  function dispatch(message: unknown): void {
    // A malformed message can only come from a bug on the Rust side; there is nothing
    // the user could do about it, so it is ignored rather than half-applied.
    if (!isRecord(message)) return;
    if (message.kind === NOTIFICATION_KINDS.filesDropped) {
      const event = toFilesDropped(message);
      if (event !== null)
        for (const listener of [...filesDroppedListeners]) listener(event);
    } else if (message.kind === NOTIFICATION_KINDS.dragState) {
      const event = toDragState(message);
      if (event !== null)
        for (const listener of [...dragStateListeners]) listener(event);
    }
  }

  // One channel per source, created on the first subscription. Rust keeps only the latest
  // subscriber, so subscribing again would silently cut off the earlier channel.
  function ensureSubscribed(): void {
    if (channel !== null) return;
    const created = new Channel<unknown>();
    created.onmessage = dispatch;
    channel = created;
    void call(COMMANDS.subscribeDropNotifications, { channel: created }, () =>
      commandOk(undefined),
    ).then((result) => {
      // Without the subscription drops go unnoticed; surface it for developers.
      if (!result.ok)
        console.error(
          "failed to subscribe to drop notifications",
          result.error,
        );
    });
  }

  return {
    subscribeFilesDropped(listener) {
      ensureSubscribed();
      filesDroppedListeners.add(listener);
      return () => {
        filesDroppedListeners.delete(listener);
      };
    },
    subscribeDragState(listener) {
      ensureSubscribed();
      dragStateListeners.add(listener);
      return () => {
        dragStateListeners.delete(listener);
      };
    },
  };
}
