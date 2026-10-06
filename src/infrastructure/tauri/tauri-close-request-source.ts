import { Channel } from "@tauri-apps/api/core";
import type {
  CloseRequest,
  CloseRequestSource,
} from "../../application/ports/window-close";
import { COMMANDS } from "./command-constants";
import { commandOk } from "./command-error";
import { call } from "./invoke-command";

// `kind` of the notification Rust sends; it must match `CloseNotification` in
// `src-tauri/src/commands/window_close.rs`.
const CLOSE_REQUESTED_KIND = "closeRequested";

function toCloseRequest(message: unknown): CloseRequest | null {
  if (typeof message !== "object" || message === null) return null;
  const { kind, subscriptionToken } = message as Record<string, unknown>;
  return kind === CLOSE_REQUESTED_KIND && typeof subscriptionToken === "string"
    ? { subscriptionToken }
    : null;
}

// Close requests arrive on an IPC channel, not through the window API: listening to window
// events would need a `core:*` permission, which the capability deliberately does not grant.
export function createTauriCloseRequestSource(): CloseRequestSource {
  const listeners = new Set<(request: CloseRequest) => void>();
  let channel: Channel<unknown> | null = null;

  // A malformed message can only come from a bug on the Rust side; it is ignored rather
  // than half-applied (the window just stays open).
  function dispatch(message: unknown): void {
    const request = toCloseRequest(message);
    if (request === null) return;
    for (const listener of [...listeners]) listener(request);
  }

  // One channel per source, created on the first subscription. Rust keeps only the latest
  // subscription (and invalidates the earlier token), so subscribing again would cut off
  // the channel that is already in use.
  function ensureSubscribed(): void {
    if (channel !== null) return;
    const created = new Channel<unknown>();
    created.onmessage = dispatch;
    channel = created;
    void call(COMMANDS.subscribeCloseRequests, { channel: created }, () =>
      commandOk(undefined),
    ).then((result) => {
      // Without the subscription Rust never learns who to ask, and the window cannot be
      // closed by the user; surface it for developers.
      if (!result.ok)
        console.error("failed to subscribe to close requests", result.error);
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
    confirmClose(subscriptionToken) {
      return call(COMMANDS.confirmWindowClose, { subscriptionToken }, () =>
        commandOk(undefined),
      );
    },
  };
}
