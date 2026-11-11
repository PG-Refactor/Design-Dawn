// The print choices of this window: kept from one print to the next, and the paper the
// canvas shows its page breaks for. Window-local, never saved.

import {
  DEFAULT_PAPER_SETTINGS,
  type PaperSettings,
} from "../../domain/print/paper";
import { createStore, type Store } from "../../shared/store/store";

// One page per sheet as large as its content, or cut into paper pages.
export type PrintMode = "fit" | "paper";

export interface PrintSettings {
  readonly mode: PrintMode;
  readonly paper: PaperSettings;
  // The canvas shows where the paper pages of the shown sheet begin and end.
  readonly showPageBreaks: boolean;
}

export type PrintSettingsStore = Store<PrintSettings>;

export function createPrintSettingsStore(): PrintSettingsStore {
  return createStore<PrintSettings>({
    mode: "fit",
    paper: DEFAULT_PAPER_SETTINGS,
    showPageBreaks: false,
  });
}
