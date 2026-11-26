import { Channel } from "@tauri-apps/api/core";
import type {
  CloseDecision,
  CloseRequest,
  CloseRequestSource,
  WindowCloseScope,
} from "../../application/ports/window-close";
import { COMMANDS } from "./command-constants";
import { type CommandResult, commandErr, commandOk } from "./command-error";
import { call } from "./invoke-command";
import { decodeBoolean, objectOf } from "./payload-decoder";

// `kind` of the notification Rust sends; it must match `CloseNotification` in
// `src-tauri/src/commands/window_close.rs`.
const CLOSE_REQUESTED_KIND = "closeRequested";
const CLOSE_DECISIONS: readonly CloseDecision[] = ["save", "discard"];
const PAYLOAD_ROOT = "payload";

function toDecision(value: unknown): CloseDecision | null | undefined {
  if (value === null) return null;
  return CLOSE_DECISIONS.find((decision) => decision === value);
}

function toCloseRequest(message: unknown): CloseRequest | null {
  if (typeof message !== "object" || message === null) return null;
  const { kind, subscriptionToken, decided } = message as Record<
    string,
    unknown
  >;
  const decision = toDecision(decided);
  return kind === CLOSE_REQUESTED_KIND &&
    typeof subscriptionToken === "string" &&
    decision !== undefined
    ? { subscriptionToken, decided: decision }
    : null;
}

const decodeScope = objectOf<WindowCloseScope>({
  endsApp: decodeBoolean,
  documentWindowsUnsaved: decodeBoolean,
});

function toScope(payload: unknown): CommandResult<WindowCloseScope> {
  const decoded = decodeScope(payload, PAYLOAD_ROOT);
  return decoded.ok
    ? commandOk(decoded.value)
    : commandErr("invalidCommandResponse", decoded.detail);
}

const discard = () => commandOk(undefined);

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
    void call(
      COMMANDS.subscribeCloseRequests,
      { channel: created },
      discard,
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
      return call(COMMANDS.confirmWindowClose, { subscriptionToken }, discard);
    },
    async bringForward() {
      await call(COMMANDS.bringWindowForward, {}, discard);
    },
    scope: () => call(COMMANDS.windowCloseScope, {}, toScope),
    async reportUnsaved(unsaved) {
      await call(COMMANDS.reportWindowUnsaved, { unsaved }, discard);
    },
    async closeDocumentWindows(decision) {
      await call(COMMANDS.closeDocumentWindows, { decision }, discard);
    },
  };
}
