import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { createTauriDropEventSource } from "./tauri-drop-event-source";

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

describe("createTauriDropEventSource", () => {
  it("creates nothing until the first subscription", async () => {
    createTauriDropEventSource();
    await settle();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(tauriCore.FakeChannel.instances).toHaveLength(0);
  });

  it("subscribes once with one channel, however many listeners", async () => {
    const source = createTauriDropEventSource();
    source.subscribeFilesDropped(vi.fn());
    source.subscribeDragState(vi.fn());
    source.subscribeDragState(vi.fn());
    await settle();
    expect(tauriCore.FakeChannel.instances).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("subscribe_drop_notifications", {
      channel: tauriCore.FakeChannel.instances[0],
    });
  });

  it("does not create a second channel after the first listener unsubscribed", async () => {
    const source = createTauriDropEventSource();
    source.subscribeDragState(vi.fn())();
    source.subscribeDragState(vi.fn());
    await settle();
    expect(tauriCore.FakeChannel.instances).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("hands decoded messages to the listeners of their kind", async () => {
    const source = createTauriDropEventSource();
    const dropped = vi.fn();
    const dragState = vi.fn();
    source.subscribeFilesDropped(dropped);
    source.subscribeDragState(dragState);
    await settle();
    send({ kind: "filesDropped", dropId: "d1", fileCount: 2 });
    send({ kind: "dragState", active: true });
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(dropped).toHaveBeenCalledWith({ dropId: "d1", fileCount: 2 });
    expect(dragState).toHaveBeenCalledTimes(1);
    expect(dragState).toHaveBeenCalledWith({ active: true });
  });

  it("serves several listeners of the same kind", async () => {
    const source = createTauriDropEventSource();
    const first = vi.fn();
    const second = vi.fn();
    source.subscribeDragState(first);
    source.subscribeDragState(second);
    send({ kind: "dragState", active: false });
    expect(first).toHaveBeenCalledWith({ active: false });
    expect(second).toHaveBeenCalledWith({ active: false });
  });

  it("ignores malformed and unknown messages", async () => {
    const source = createTauriDropEventSource();
    const dropped = vi.fn();
    const dragState = vi.fn();
    source.subscribeFilesDropped(dropped);
    source.subscribeDragState(dragState);
    await settle();
    send({ kind: "filesDropped", dropId: 7 });
    send({ kind: "filesDropped" });
    send({ kind: "dragState", active: "yes" });
    send({ kind: "somethingElse", active: true });
    send({ dropId: "d1", fileCount: 1 });
    send(null);
    send("dragState");
    expect(dropped).not.toHaveBeenCalled();
    expect(dragState).not.toHaveBeenCalled();
  });

  it("stops delivering to an unsubscribed listener only", async () => {
    const source = createTauriDropEventSource();
    const stopped = vi.fn();
    const kept = vi.fn();
    const stop = source.subscribeDragState(stopped);
    source.subscribeDragState(kept);
    await settle();
    stop();
    send({ kind: "dragState", active: true });
    expect(stopped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledWith({ active: true });
  });

  it("logs a rejected subscription", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    invokeMock.mockRejectedValue("denied");
    createTauriDropEventSource().subscribeFilesDropped(vi.fn());
    await settle();
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
