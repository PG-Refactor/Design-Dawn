import type { ThemePreference } from "../../application/local-state/theme";
import type { Viewport } from "../../application/local-state/viewport";
import type { CommandErrorKind } from "./command-error";

// Why the stored file could not be used. The value next to it is then the default.
export interface LocalStateLoadIssue {
  readonly kind: CommandErrorKind;
  readonly detail: string;
}

export interface AppSettings {
  readonly themePreference: ThemePreference;
  readonly loadIssue: LocalStateLoadIssue | null;
}

export interface SheetViewportState {
  // Null when nothing is saved for the sheet (or the file was unusable: see `loadIssue`).
  readonly viewport: Viewport | null;
  readonly loadIssue: LocalStateLoadIssue | null;
}
