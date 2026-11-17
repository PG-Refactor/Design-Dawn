// Typed wrappers for the Application Local State commands.
// Loading problems arrive as `loadIssue` next to default values, not as errors.

import type { ThemePreference } from "../../application/local-state/theme";
import type { Viewport } from "../../application/local-state/viewport";
import type { LanguagePreference } from "../../config/language-config";
import type { TextSize } from "../../config/text-size-config";
import {
  type DocumentId,
  type ProjectId,
  parseSheetId,
  type SheetId,
} from "../../domain/shared/entity-id";
import { COMMANDS } from "./command-constants";
import { type CommandResult, commandErr, commandOk } from "./command-error";
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

export function setTextSize(
  textSize: TextSize,
): Promise<CommandResult<AppSettings>> {
  return call(COMMANDS.setTextSize, { textSize }, toAppSettingsResult);
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

function toOptionalSheetIdResult(
  payload: unknown,
): CommandResult<SheetId | null> {
  if (payload === null || payload === undefined) return commandOk(null);
  if (typeof payload !== "string") {
    return commandErr("invalidCommandResponse", "payload: expected a sheet id");
  }
  const parsed = parseSheetId(payload);
  return parsed.ok
    ? commandOk(parsed.value)
    : commandErr("invalidCommandResponse", `payload: ${parsed.error.detail}`);
}

export function getActiveSheet(
  projectId: ProjectId,
  documentId: DocumentId,
): Promise<CommandResult<SheetId | null>> {
  return call(
    COMMANDS.getActiveSheet,
    { projectId, documentId },
    toOptionalSheetIdResult,
  );
}

export function saveActiveSheet(
  projectId: ProjectId,
  documentId: DocumentId,
  sheetId: SheetId,
): Promise<CommandResult<null>> {
  return call(
    COMMANDS.saveActiveSheet,
    { projectId, documentId, sheetId },
    toVoidResult,
  );
}
