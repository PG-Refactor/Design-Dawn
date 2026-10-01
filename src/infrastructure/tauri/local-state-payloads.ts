// Converts local state command payloads into typed values. Shapes are checked first, then
// the same parsers TypeScript callers use, so everything Rust returns is validated again.
// A payload that fails either step is `invalidCommandResponse`.

import type { LocalStateResult } from "../../application/local-state/local-state-result";
import {
  parseThemePreference,
  type ThemePreference,
} from "../../application/local-state/theme";
import {
  parseViewport,
  type RawViewport,
  type Viewport,
} from "../../application/local-state/viewport";
import {
  type CommandResult,
  commandErr,
  commandOk,
  isRustErrorKind,
} from "./command-error";
import type {
  AppSettings,
  LocalStateLoadIssue,
  SheetViewportState,
} from "./local-state-types";
import {
  type Decoded,
  type Decoder,
  decodeNumber,
  decodeString,
  nullable,
  objectOf,
} from "./payload-decoder";

const PAYLOAD_ROOT = "payload";

const decodeErrorKind: Decoder<LocalStateLoadIssue["kind"]> = (value, path) =>
  typeof value === "string" && isRustErrorKind(value)
    ? { ok: true, value }
    : { ok: false, detail: `${path}: expected a Rust error kind` };

const decodeLoadIssue = objectOf<LocalStateLoadIssue>({
  kind: decodeErrorKind,
  detail: decodeString,
});

interface RawAppSettings {
  readonly themePreference: string;
  readonly loadIssue: LocalStateLoadIssue | null;
}
interface RawSheetViewportState {
  readonly viewport: RawViewport | null;
  readonly loadIssue: LocalStateLoadIssue | null;
}

const rawAppSettings = objectOf<RawAppSettings>({
  themePreference: decodeString,
  loadIssue: nullable(decodeLoadIssue),
});
const rawSheetViewportState = objectOf<RawSheetViewportState>({
  viewport: nullable(
    objectOf<RawViewport>({
      panX: decodeNumber,
      panY: decodeNumber,
      zoom: decodeNumber,
    }),
  ),
  loadIssue: nullable(decodeLoadIssue),
});

function decodePayload<T>(
  decoder: Decoder<T>,
  payload: unknown,
): CommandResult<T> {
  const result: Decoded<T> = decoder(payload, PAYLOAD_ROOT);
  return result.ok
    ? commandOk(result.value)
    : commandErr("invalidCommandResponse", result.detail);
}

// A value that decodes but breaks a parser rule is a malformed response, not the caller's error.
function asResponseValue<T>(result: LocalStateResult<T>): CommandResult<T> {
  return result.ok
    ? commandOk(result.value)
    : commandErr(
        "invalidCommandResponse",
        `${PAYLOAD_ROOT}: ${result.error.kind}: ${result.error.detail}`,
      );
}

export function toAppSettingsResult(
  payload: unknown,
): CommandResult<AppSettings> {
  const raw = decodePayload(rawAppSettings, payload);
  if (!raw.ok) return raw;
  const themePreference: CommandResult<ThemePreference> = asResponseValue(
    parseThemePreference(raw.value.themePreference),
  );
  if (!themePreference.ok) return themePreference;
  return commandOk({
    themePreference: themePreference.value,
    loadIssue: raw.value.loadIssue,
  });
}

export function toSheetViewportStateResult(
  payload: unknown,
): CommandResult<SheetViewportState> {
  const raw = decodePayload(rawSheetViewportState, payload);
  if (!raw.ok) return raw;
  let viewport: Viewport | null = null;
  if (raw.value.viewport !== null) {
    const parsed = asResponseValue(parseViewport(raw.value.viewport));
    if (!parsed.ok) return parsed;
    viewport = parsed.value;
  }
  return commandOk({ viewport, loadIssue: raw.value.loadIssue });
}
