import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { createTauriCloseRequestSource } from "./tauri-close-request-source";

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

function send(message: unknown): void {
  tauriCore.FakeChannel.instances[0]?.onmessage(message);
}

beforeEach(() => {
  tauriCore.FakeChannel.instances = [];
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});

describe("createTauriCloseRequestSource", () => {
  it("creates nothing until the first subscription", async () => {
    createTauriCloseRequestSource();
    await settle();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("subscribes once with one channel, however many listeners", async () => {
    const source = createTauriCloseRequestSource();
    source.subscribe(vi.fn())();
    source.subscribe(vi.fn());
    source.subscribe(vi.fn());
    await settle();
    expect(tauriCore.FakeChannel.instances).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("subscribe_close_requests", {
      channel: tauriCore.FakeChannel.instances[0],
    });
  });

  it("hands decoded requests to the listeners and ignores malformed ones", async () => {
    const source = createTauriCloseRequestSource();
    const listener = vi.fn();
    source.subscribe(listener);
    await settle();
    send({ kind: "closeRequested", subscriptionToken: "t1" });
    send({ kind: "closeRequested" });
    send({ kind: "closeRequested", subscriptionToken: 5 });
    send({ kind: "other", subscriptionToken: "t2" });
    send(null);
    send("closeRequested");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ subscriptionToken: "t1" });
  });

  it("stops delivering after unsubscribing", async () => {
    const source = createTauriCloseRequestSource();
    const listener = vi.fn();
    const stop = source.subscribe(listener);
    stop();
    send({ kind: "closeRequested", subscriptionToken: "t1" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("confirms with the token it is given", async () => {
    const source = createTauriCloseRequestSource();
    const result = await source.confirmClose("t9");
    expect(result.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("confirm_window_close", {
      subscriptionToken: "t9",
    });
  });

  it("reports a rejected confirmation as an error result", async () => {
    invokeMock.mockRejectedValue({ kind: "ioError", detail: "x" });
    const result = await createTauriCloseRequestSource().confirmClose("t9");
    expect(result.ok).toBe(false);
  });
});
