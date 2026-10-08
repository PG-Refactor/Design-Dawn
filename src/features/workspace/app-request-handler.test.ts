import { describe, expect, it, vi } from "vitest";
import { operationOk } from "../../application/ports/operation-error";
import { documentIdOf, settle } from "../../application/test-support/fakes";
import {
  createAppRequestHandler,
  createSettingsChangeHandler,
} from "./app-request-handler";

const DOCUMENT = documentIdOf(1);

function request(requestId: string) {
  return { requestId, documentId: DOCUMENT };
}

function setup(options: { closing?: boolean; ready?: Promise<unknown> } = {}) {
  const events: string[] = [];
  const state = { closing: options.closing ?? false };
  const handler = createAppRequestHandler({
    openDocument: (documentId) => {
      events.push(`open:${documentId}`);
      return Promise.resolve(operationOk(undefined));
    },
    acknowledge: (requestId) => {
      events.push(`ack:${requestId}`);
      return Promise.resolve(operationOk(undefined));
    },
    isClosing: () => state.closing,
    whenReady: () => options.ready ?? Promise.resolve(),
  });
  return { handler, events, state };
}

describe("app request handler", () => {
  it("opens the document, then acknowledges the request", async () => {
    const { handler, events } = setup();
    handler.handle(request("r1"));
    await settle();
    expect(events).toEqual([`open:${DOCUMENT}`, "ack:r1"]);
  });

  it("handles requests one after the other", async () => {
    const { handler, events } = setup();
    handler.handle(request("r1"));
    handler.handle(request("r2"));
    await settle();
    expect(events).toEqual([
      `open:${DOCUMENT}`,
      "ack:r1",
      `open:${DOCUMENT}`,
      "ack:r2",
    ]);
  });

  it("ignores a request id it already has", async () => {
    const { handler, events } = setup();
    handler.handle(request("r1"));
    handler.handle(request("r1"));
    await settle();
    expect(events).toEqual([`open:${DOCUMENT}`, "ack:r1"]);
  });

  it("waits for the launch request before handling anything", async () => {
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { handler, events } = setup({ ready });
    handler.handle(request("r1"));
    await settle();
    expect(events).toEqual([]);
    release();
    await settle();
    expect(events).toEqual([`open:${DOCUMENT}`, "ack:r1"]);
  });

  it("neither handles nor acknowledges while the window is closing", async () => {
    const { handler, events } = setup({ closing: true });
    handler.handle(request("r1"));
    await settle();
    expect(events).toEqual([]);
  });

  it("processes the queue after the close stopped", async () => {
    const { handler, events, state } = setup({ closing: true });
    handler.handle(request("r1"));
    handler.handle(request("r2"));
    await settle();

    state.closing = false;
    handler.resume();
    await settle();

    expect(events).toEqual([
      `open:${DOCUMENT}`,
      "ack:r1",
      `open:${DOCUMENT}`,
      "ack:r2",
    ]);
  });

  it("stops between two requests when a close begins", async () => {
    const events: string[] = [];
    let closing = false;
    let finishFirst: () => void = () => undefined;
    const handler = createAppRequestHandler({
      openDocument: () => {
        events.push("open");
        return new Promise((resolve) => {
          finishFirst = () => resolve(operationOk(undefined));
        });
      },
      acknowledge: (requestId) => {
        events.push(`ack:${requestId}`);
        return Promise.resolve(operationOk(undefined));
      },
      isClosing: () => closing,
      whenReady: () => Promise.resolve(),
    });
    handler.handle(request("r1"));
    handler.handle(request("r2"));
    await settle();

    closing = true;
    finishFirst();
    await settle();

    // r1 was already under way and is finished; r2 waits for the close to end.
    expect(events).toEqual(["open", "ack:r1"]);
  });

  it("does nothing after it was disposed", async () => {
    const { handler, events } = setup();
    handler.dispose();
    handler.handle(request("r1"));
    handler.resume();
    await settle();
    expect(events).toEqual([]);
  });
});

describe("settings change handler", () => {
  it("hands the theme and auto-save values to their controllers", () => {
    const applyThemePreference = vi.fn();
    const applyAutoSave = vi.fn();
    const handle = createSettingsChangeHandler({
      applyThemePreference,
      applyAutoSave,
    });
    handle({ themePreference: "dark", autoSave: false });
    expect(applyThemePreference).toHaveBeenCalledWith("dark");
    expect(applyAutoSave).toHaveBeenCalledWith(false);
  });
});
