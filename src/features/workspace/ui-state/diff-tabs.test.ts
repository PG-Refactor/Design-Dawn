import { describe, expect, it } from "vitest";
import {
  activateDiffTab,
  closeDiffTab,
  openDiffTab,
  pinDiffTab,
  showDocumentTab,
} from "./diff-tabs";
import { createInitialUiState, type UiState } from "./ui-state";
import { resetUiState } from "./ui-state-cleanup";

const A = { path: "a.md", side: "unstaged" } as const;
const B = { path: "b.md", side: "unstaged" } as const;
const C = { path: "c.md", side: "staged" } as const;

function paths(state: UiState): string[] {
  return state.diffTabs.map(
    (tab) => `${tab.path}:${tab.side}:${tab.preview ? "preview" : "pinned"}`,
  );
}

describe("openDiffTab", () => {
  it("opens a preview tab and activates it", () => {
    const state = openDiffTab(createInitialUiState(), A, false);
    expect(paths(state)).toEqual(["a.md:unstaged:preview"]);
    expect(state.activeMainTab).toEqual({ kind: "diff", ...A });
  });

  it("replaces the preview tab in its place by the next preview", () => {
    let state = openDiffTab(createInitialUiState(), A, true);
    state = openDiffTab(state, B, false);
    state = openDiffTab(state, C, false);
    expect(paths(state)).toEqual([
      "a.md:unstaged:pinned",
      "c.md:staged:preview",
    ]);
    expect(state.activeMainTab).toEqual({ kind: "diff", ...C });
  });

  it("only activates an existing tab and keeps its preview state", () => {
    let state = openDiffTab(createInitialUiState(), A, false);
    state = openDiffTab(state, B, true);
    const again = openDiffTab(state, A, false);
    expect(paths(again)).toEqual([
      "a.md:unstaged:preview",
      "b.md:unstaged:pinned",
    ]);
    expect(again.activeMainTab).toEqual({ kind: "diff", ...A });
  });

  it("pins an existing preview tab when asked to pin", () => {
    const state = openDiffTab(createInitialUiState(), A, false);
    expect(paths(openDiffTab(state, A, true))).toEqual([
      "a.md:unstaged:pinned",
    ]);
  });
});

describe("pinDiffTab", () => {
  it("pins a preview tab, and keeps the state otherwise", () => {
    const preview = openDiffTab(createInitialUiState(), A, false);
    const pinned = pinDiffTab(preview, A);
    expect(paths(pinned)).toEqual(["a.md:unstaged:pinned"]);
    expect(pinDiffTab(pinned, A)).toBe(pinned);
    expect(pinDiffTab(pinned, B)).toBe(pinned);
  });
});

describe("closeDiffTab", () => {
  it("activates the next tab, else the previous, else the Document", () => {
    let state = openDiffTab(createInitialUiState(), A, true);
    state = openDiffTab(state, B, true);
    state = openDiffTab(state, C, true);
    const middle = closeDiffTab(activateDiffTab(state, B), B);
    expect(middle.activeMainTab).toEqual({ kind: "diff", ...C });
    const last = closeDiffTab(middle, C);
    expect(last.activeMainTab).toEqual({ kind: "diff", ...A });
    const none = closeDiffTab(last, A);
    expect(none.activeMainTab).toEqual({ kind: "document" });
    expect(none.diffTabs).toEqual([]);
  });

  it("keeps the active tab when another one closes", () => {
    let state = openDiffTab(createInitialUiState(), A, true);
    state = openDiffTab(state, B, true);
    const closed = closeDiffTab(state, A);
    expect(closed.activeMainTab).toEqual({ kind: "diff", ...B });
    expect(closeDiffTab(closed, A)).toBe(closed);
  });
});

describe("main tab", () => {
  it("shows the Document again without closing the diff tabs", () => {
    const state = openDiffTab(createInitialUiState(), A, true);
    const shown = showDocumentTab(state);
    expect(shown.activeMainTab).toEqual({ kind: "document" });
    expect(shown.diffTabs).toHaveLength(1);
    expect(showDocumentTab(shown)).toBe(shown);
  });

  it("is reset with the Project", () => {
    const state = openDiffTab(createInitialUiState(), A, true);
    expect(resetUiState().diffTabs).toEqual([]);
    expect(resetUiState().activeMainTab).toEqual({ kind: "document" });
    expect(state.diffTabs).toHaveLength(1);
  });
});
