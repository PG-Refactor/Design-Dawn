// What the two find boxes hold while the window is open: the Search tab of the sidebar
// (the whole Project, Ctrl+Shift+F) and the find box over the canvas (the shown sheet,
// Ctrl+F). Kept outside the components so the text survives closing a box or switching
// the sidebar tab; window-local and never saved.

import { createStore, type Store } from "../../shared/store/store";

export interface FindFields {
  readonly query: string;
  readonly matchCase: boolean;
  readonly replacement: string;
  // The replace row is shown (the arrow at the left of the box).
  readonly replaceShown: boolean;
}

export type FindTarget = "project" | "sheet";

export interface SheetFindState extends FindFields {
  readonly open: boolean;
  // Index of the current match among the sheet's matches.
  readonly current: number;
}

export interface FindState {
  readonly project: FindFields;
  readonly sheet: SheetFindState;
  // Bumped to move the focus into a box (which then selects its text).
  readonly focusRequest: {
    readonly target: FindTarget;
    readonly sequence: number;
  };
}

export type FindStore = Store<FindState>;

const EMPTY_FIELDS: FindFields = {
  query: "",
  matchCase: false,
  replacement: "",
  replaceShown: false,
};

export function createFindStore(): FindStore {
  return createStore<FindState>({
    project: EMPTY_FIELDS,
    sheet: { ...EMPTY_FIELDS, open: false, current: 0 },
    focusRequest: { target: "project", sequence: 0 },
  });
}

// A selected text worth searching for: one line, not blank.
export function seedFromSelection(selected: string): string | null {
  if (selected.trim().length === 0 || /[\r\n]/.test(selected)) return null;
  return selected;
}

// Opens a box with the focus in it; `seed` (the selected text) replaces its query.
export function requestFind(
  store: FindStore,
  target: FindTarget,
  seed: string | null,
): void {
  store.setState((state) => {
    const sequence = state.focusRequest.sequence + 1;
    const focusRequest = { target, sequence };
    if (target === "project") {
      return {
        ...state,
        project:
          seed === null ? state.project : { ...state.project, query: seed },
        focusRequest,
      };
    }
    return {
      ...state,
      sheet: {
        ...state.sheet,
        ...(seed === null ? {} : { query: seed, current: 0 }),
        open: true,
      },
      focusRequest,
    };
  });
}
