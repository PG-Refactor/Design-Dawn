import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimeoutScheduler } from "./timeout-scheduler";

const DELAY_MS = 500;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createTimeoutScheduler", () => {
  it("runs the callback once after the delay", () => {
    const callback = vi.fn();
    createTimeoutScheduler().schedule(DELAY_MS, callback);
    vi.advanceTimersByTime(DELAY_MS - 1);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not run a cancelled callback", () => {
    const callback = vi.fn();
    const cancel = createTimeoutScheduler().schedule(DELAY_MS, callback);
    cancel();
    vi.advanceTimersByTime(DELAY_MS * 2);
    expect(callback).not.toHaveBeenCalled();
  });
});
