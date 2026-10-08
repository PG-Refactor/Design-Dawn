import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { createTauriAppRequestSource } from "./tauri-app-request-source";

const tauriCore = vi.hoisted(() => {
  class FakeChannel {
    onmessage: (message: unknown) => void = () => {};
    constructor() {
      FakeChannel.instances.push(this);
    }
    static instances: FakeChannel[] = [];
  }
  return { FakeChannel, invoke: vi.fn() };
});
vi.mock("@tauri-apps/api/core", () => ({
  Channel: tauriCore.FakeChannel,
  invoke: tauriCore.invoke,
}));
const invokeMock = vi.mocked(invoke);

const DOCUMENT_ID = "01928f3a-0000-7000-8000-0000000000aa";

function send(message: unknown): void {
  tauriCore.FakeChannel.instances[0]?.onmessage(message);
}

beforeEach(() => {
  tauriCore.FakeChannel.instances = [];
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});

describe("createTauriAppRequestSource", () => {
  it("subscribes once with one channel, however many listeners", async () => {
    const source = createTauriAppRequestSource();
    source.subscribe(vi.fn())();
    source.subscribe(vi.fn());
    await settle();
    expect(tauriCore.FakeChannel.instances).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("subscribe_app_requests", {
      channel: tauriCore.FakeChannel.instances[0],
    });
  });

  it("creates nothing until the first subscription", async () => {
    createTauriAppRequestSource();
    await settle();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("hands decoded open requests to the listeners and ignores malformed ones", async () => {
    const source = createTauriAppRequestSource();
    const listener = vi.fn();
    source.subscribe(listener);
    send({ kind: "openDocument", requestId: "r1", documentId: DOCUMENT_ID });
    send({ kind: "openDocument", requestId: "r2" });
    send({ kind: "openDocument", requestId: 3, documentId: DOCUMENT_ID });
    send({ kind: "openDocument", requestId: "r4", documentId: "not-an-id" });
    send({ kind: "settingsChanged", requestId: "r5", documentId: DOCUMENT_ID });
    send(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      requestId: "r1",
      documentId: DOCUMENT_ID,
    });
  });

  it("stops delivering after unsubscribing", () => {
    const source = createTauriAppRequestSource();
    const listener = vi.fn();
    source.subscribe(listener)();
    send({ kind: "openDocument", requestId: "r1", documentId: DOCUMENT_ID });
    expect(listener).not.toHaveBeenCalled();
  });

  it("acknowledges with the request id", async () => {
    const result =
      await createTauriAppRequestSource().acknowledgeOpenRequest("r1");
    expect(result.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("ack_open_request", {
      requestId: "r1",
    });
  });

  it("reports a rejected acknowledgement as an error result", async () => {
    invokeMock.mockRejectedValue({ kind: "ioError", detail: "x" });
    const result =
      await createTauriAppRequestSource().acknowledgeOpenRequest("r1");
    expect(result.ok).toBe(false);
  });
});

describe("settingsChanged", () => {
  it("hands decoded settings to the settings listeners only", () => {
    const source = createTauriAppRequestSource();
    const openListener = vi.fn();
    const settingsListener = vi.fn();
    source.subscribe(openListener);
    source.subscribeSettings(settingsListener);
    send({ kind: "settingsChanged", themePreference: "dark", autoSave: false });
    expect(settingsListener).toHaveBeenCalledWith({
      themePreference: "dark",
      autoSave: false,
    });
    expect(openListener).not.toHaveBeenCalled();
  });

  it("ignores malformed settings", () => {
    const source = createTauriAppRequestSource();
    const settingsListener = vi.fn();
    source.subscribeSettings(settingsListener);
    send({ kind: "settingsChanged", themePreference: "sepia", autoSave: true });
    send({ kind: "settingsChanged", themePreference: "dark" });
    send({ kind: "settingsChanged", themePreference: "dark", autoSave: "yes" });
    send({ kind: "somethingElse", themePreference: "dark", autoSave: true });
    expect(settingsListener).not.toHaveBeenCalled();
  });

  it("shares the one channel with the open requests and stops after unsubscribing", async () => {
    const source = createTauriAppRequestSource();
    const settingsListener = vi.fn();
    source.subscribe(vi.fn());
    const unsubscribe = source.subscribeSettings(settingsListener);
    await settle();
    expect(tauriCore.FakeChannel.instances).toHaveLength(1);
    unsubscribe();
    send({ kind: "settingsChanged", themePreference: "light", autoSave: true });
    expect(settingsListener).not.toHaveBeenCalled();
  });
});
