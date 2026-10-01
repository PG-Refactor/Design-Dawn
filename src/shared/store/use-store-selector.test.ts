import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createStore } from "./store";
import { readSelection, useStoreSelector } from "./use-store-selector";

interface State {
  readonly items: readonly number[];
  readonly other: number;
}

const selectItems = (state: State) => state.items;
const selectCopy = (state: State) => ({ total: state.items.length });
const sameTotal = (a: { total: number }, b: { total: number }) =>
  a.total === b.total;

describe("readSelection", () => {
  it("returns the cached value for the same state and selector", () => {
    const state: State = { items: [1], other: 0 };
    const first = readSelection(null, state, selectCopy, Object.is);
    expect(readSelection(first, state, selectCopy, Object.is)).toBe(first);
  });

  it("keeps the previous value when the new selection is equal", () => {
    const first = readSelection(
      null,
      { items: [1], other: 0 },
      selectCopy,
      sameTotal,
    );
    const second = readSelection(
      first,
      { items: [2], other: 1 },
      selectCopy,
      sameTotal,
    );
    expect(second.selected).toBe(first.selected);
  });

  it("returns a new value when the selection differs", () => {
    const first = readSelection(
      null,
      { items: [1], other: 0 },
      selectItems,
      Object.is,
    );
    const second = readSelection(
      first,
      { items: [1, 2], other: 0 },
      selectItems,
      Object.is,
    );
    expect(second.selected).not.toBe(first.selected);
  });

  it("recomputes when only the selector changed", () => {
    const state: State = { items: [1], other: 5 };
    const first = readSelection(null, state, selectItems, Object.is);
    const second = readSelection(first, state, (s) => s.other, Object.is);
    expect(second.selected).toBe(5);
  });
});

describe("useStoreSelector", () => {
  it("renders the selected value on the server without a DOM", () => {
    const store = createStore<State>({ items: [1, 2, 3], other: 0 });
    const Count = () =>
      createElement(
        "span",
        null,
        useStoreSelector(store, selectCopy, sameTotal).total,
      );
    expect(renderToString(createElement(Count))).toContain("3");
  });

  it("reflects the current store state at render time", () => {
    const store = createStore<State>({ items: [], other: 0 });
    const Other = () =>
      createElement(
        "span",
        null,
        useStoreSelector(store, (s) => s.other),
      );
    store.setState({ items: [], other: 42 });
    expect(renderToString(createElement(Other))).toContain("42");
  });
});
