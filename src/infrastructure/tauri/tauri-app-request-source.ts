import { Channel } from "@tauri-apps/api/core";
import type {
  AppRequestSource,
  OpenDocumentRequest,
} from "../../application/ports/app-request-source";
import { parseDocumentId } from "../../domain/shared/entity-id";
import { COMMANDS } from "./command-constants";
import { commandOk } from "./command-error";
import { call } from "./invoke-command";

// `kind` of the notification Rust sends; it must match `AppNotification` in
// `src-tauri/src/commands/app_channel.rs`.
const OPEN_DOCUMENT_KIND = "openDocument";

function toOpenDocumentRequest(message: unknown): OpenDocumentRequest | null {
  if (typeof message !== "object" || message === null) return null;
  const { kind, requestId, documentId } = message as Record<string, unknown>;
  if (
    kind !== OPEN_DOCUMENT_KIND ||
    typeof requestId !== "string" ||
    typeof documentId !== "string"
  ) {
    return null;
  }
  const parsed = parseDocumentId(documentId);
  return parsed.ok ? { requestId, documentId: parsed.value } : null;
}

// Requests arrive on an IPC channel for the same reason as close requests: listening to
// events would need a `core:*` permission, which the capability does not grant.
export function createTauriAppRequestSource(): AppRequestSource {
  const listeners = new Set<(request: OpenDocumentRequest) => void>();
  let channel: Channel<unknown> | null = null;

  // A malformed message can only come from a bug on the Rust side. It stays
  // unacknowledged there, so it is ignored rather than half-applied.
  function dispatch(message: unknown): void {
    const request = toOpenDocumentRequest(message);
    if (request === null) return;
    for (const listener of [...listeners]) listener(request);
  }

  // One channel per source, created on the first subscription: Rust keeps only the latest
  // one, so subscribing again would cut off the channel in use. Subscribing makes Rust send
  // what the window has not acknowledged yet.
  function ensureSubscribed(): void {
    if (channel !== null) return;
    const created = new Channel<unknown>();
    created.onmessage = dispatch;
    channel = created;
    void call(COMMANDS.subscribeAppRequests, { channel: created }, () =>
      commandOk(undefined),
    ).then((result) => {
      if (!result.ok)
        console.error("failed to subscribe to app requests", result.error);
    });
  }

  return {
    subscribe(listener) {
      ensureSubscribed();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    acknowledgeOpenRequest(requestId) {
      return call(COMMANDS.ackOpenRequest, { requestId }, () =>
        commandOk(undefined),
      );
    },
  };
}
