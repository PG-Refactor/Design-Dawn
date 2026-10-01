import { describe, expect, it, vi } from "vitest";
import { createStore } from "./store";

describe("createStore", () => {
  it("returns the initial state and applies values and updaters", () => {
    const store = createStore({ count: 0 });
    expect(store.getState()).toEqual({ count: 0 });
    store.setState({ count: 1 });
    store.setState((previous) => ({ count: previous.count + 1 }));
    expect(store.getState()).toEqual({ count: 2 });
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setState({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.setState({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the state reference is unchanged", () => {
    const initial = { count: 0 };
    const store = createStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState(initial);
    store.setState((previous) => previous);
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies for an equal but new object", () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({ count: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not call a listener that was unsubscribed during notification", () => {
    const store = createStore({ count: 0 });
    const second = vi.fn();
    let unsubscribeSecond: () => void = () => undefined;
    store.subscribe(() => unsubscribeSecond());
    unsubscribeSecond = store.subscribe(second);
    store.setState({ count: 1 });
    expect(second).not.toHaveBeenCalled();
  });

  it("allows a listener to unsubscribe itself", () => {
    const store = createStore({ count: 0 });
    const calls: number[] = [];
    const unsubscribe = store.subscribe(() => {
      calls.push(store.getState().count);
      unsubscribe();
    });
    store.setState({ count: 1 });
    store.setState({ count: 2 });
    expect(calls).toEqual([1]);
  });

  it("keeps subscriptions of the same function independent", () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    const first = store.subscribe(listener);
    store.subscribe(listener);
    first();
    store.setState({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
