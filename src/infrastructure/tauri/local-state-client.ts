// Typed wrappers for the Application Local State commands.
// Loading problems arrive as `loadIssue` next to default values, not as errors.

import type { ThemePreference } from "../../application/local-state/theme";
import type { Viewport } from "../../application/local-state/viewport";
import type { LanguagePreference } from "../../config/language-config";
import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import { COMMANDS } from "./command-constants";
import type { CommandResult } from "./command-error";
import { call } from "./invoke-command";
import {
  toAppSettingsResult,
  toSheetViewportStateResult,
} from "./local-state-payloads";
import type { AppSettings, SheetViewportState } from "./local-state-types";
import { toVoidResult } from "./persistence-payloads";

export function getAppSettings(): Promise<CommandResult<AppSettings>> {
  return call(COMMANDS.getAppSettings, {}, toAppSettingsResult);
}

export function setThemePreference(
  themePreference: ThemePreference,
): Promise<CommandResult<AppSettings>> {
  return call(
    COMMANDS.setThemePreference,
    { themePreference },
    toAppSettingsResult,
  );
}

export function setLanguagePreference(
  languagePreference: LanguagePreference,
): Promise<CommandResult<AppSettings>> {
  return call(
    COMMANDS.setLanguagePreference,
    { languagePreference },
    toAppSettingsResult,
  );
}

export function setAutoSave(
  enabled: boolean,
): Promise<CommandResult<AppSettings>> {
  return call(COMMANDS.setAutoSave, { enabled }, toAppSettingsResult);
}

export function setProjectTreeWidth(
  width: number,
): Promise<CommandResult<AppSettings>> {
  return call(COMMANDS.setProjectTreeWidth, { width }, toAppSettingsResult);
}

export function getSheetViewport(
  projectId: ProjectId,
  documentId: DocumentId,
  sheetId: SheetId,
): Promise<CommandResult<SheetViewportState>> {
  return call(
    COMMANDS.getSheetViewport,
    { projectId, documentId, sheetId },
    toSheetViewportStateResult,
  );
}

export function saveSheetViewport(
  projectId: ProjectId,
  documentId: DocumentId,
  sheetId: SheetId,
  viewport: Viewport,
): Promise<CommandResult<null>> {
  return call(
    COMMANDS.saveSheetViewport,
    { projectId, documentId, sheetId, viewport },
    toVoidResult,
  );
}
