import { describe, expect, it, vi } from "vitest";
import { createListenerSet, rethrowLater } from "./listener-set";

describe("createListenerSet", () => {
  it("skips a listener unsubscribed during the notification and reports a failing one", () => {
    const failures: unknown[] = [];
    const set = createListenerSet<number>((failure) => failures.push(failure));
    const seen: number[] = [];
    let unsubscribeSecond = () => {};
    set.subscribe(() => {
      unsubscribeSecond();
      throw new Error("first fails");
    });
    unsubscribeSecond = set.subscribe((event) => seen.push(event));
    set.notify(1);
    expect(seen).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it("rethrows a failure in a microtask by default", () => {
    const scheduled = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation(() => {});
    rethrowLater(new Error("later"));
    const task = scheduled.mock.calls[0]?.[0];
    scheduled.mockRestore();
    expect(() => task?.()).toThrow("later");
  });
});
