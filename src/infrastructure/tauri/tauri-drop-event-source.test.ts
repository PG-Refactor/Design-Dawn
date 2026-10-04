import { type EventCallback, listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { EVENTS } from "./event-constants";
import { createTauriDropEventSource } from "./tauri-drop-event-source";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const listenMock = vi.mocked(listen);

const handlers = new Map<string, EventCallback<unknown>>();
const unlisteners = new Map<string, ReturnType<typeof vi.fn>>();

function emit(eventName: string, payload: unknown): void {
  handlers.get(eventName)?.({
    event: eventName,
    id: 1,
    payload,
  });
}

beforeEach(() => {
  handlers.clear();
  unlisteners.clear();
  listenMock.mockReset();
  listenMock.mockImplementation(async (eventName, handler) => {
    handlers.set(eventName, handler as EventCallback<unknown>);
    const unlisten = vi.fn();
    unlisteners.set(eventName, unlisten);
    return unlisten;
  });
});

describe("createTauriDropEventSource", () => {
  it("subscribes to the Rust event names", async () => {
    const source = createTauriDropEventSource();
    source.subscribeFilesDropped(vi.fn());
    source.subscribeDragState(vi.fn());
    await settle();
    expect(listenMock.mock.calls.map(([eventName]) => eventName)).toEqual([
      "dawn://files-dropped",
      "dawn://drag-state",
    ]);
    expect(EVENTS).toEqual({
      filesDropped: "dawn://files-dropped",
      dragState: "dawn://drag-state",
    });
  });

  it("hands decoded payloads to the listeners", async () => {
    const source = createTauriDropEventSource();
    const dropped = vi.fn();
    const dragState = vi.fn();
    source.subscribeFilesDropped(dropped);
    source.subscribeDragState(dragState);
    await settle();
    emit(EVENTS.filesDropped, { dropId: "d1", fileCount: 2 });
    emit(EVENTS.dragState, { active: true });
    expect(dropped).toHaveBeenCalledWith({ dropId: "d1", fileCount: 2 });
    expect(dragState).toHaveBeenCalledWith({ active: true });
  });

  it("ignores malformed payloads", async () => {
    const source = createTauriDropEventSource();
    const dropped = vi.fn();
    const dragState = vi.fn();
    source.subscribeFilesDropped(dropped);
    source.subscribeDragState(dragState);
    await settle();
    emit(EVENTS.filesDropped, { dropId: 7 });
    emit(EVENTS.filesDropped, null);
    emit(EVENTS.dragState, { active: "yes" });
    expect(dropped).not.toHaveBeenCalled();
    expect(dragState).not.toHaveBeenCalled();
  });

  it("detaches the listener when unsubscribed", async () => {
    const stop = createTauriDropEventSource().subscribeFilesDropped(vi.fn());
    await settle();
    stop();
    expect(unlisteners.get(EVENTS.filesDropped)).toHaveBeenCalledTimes(1);
  });

  it("detaches a listener that was unsubscribed before the registration finished", async () => {
    const listener = vi.fn();
    const stop = createTauriDropEventSource().subscribeDragState(listener);
    stop();
    await settle();
    expect(unlisteners.get(EVENTS.dragState)).toHaveBeenCalledTimes(1);
    emit(EVENTS.dragState, { active: true });
    expect(listener).not.toHaveBeenCalled();
  });
});
