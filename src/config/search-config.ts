// The find boxes (the Project search in the sidebar and the find box over the canvas).
export const SEARCH_CONFIG = {
  // What Rust stops at; shown in the "only the first N" note.
  projectResultLimit: 500,
  // The Project is searched this long after the last key, so typing is not slowed by a
  // search of every file per letter.
  projectTypingDelayMs: 300,
} as const;
