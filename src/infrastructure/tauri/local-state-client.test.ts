import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseViewport } from "../../application/local-state/viewport";
import {
  parseDocumentId,
  parseProjectId,
  parseSheetId,
} from "../../domain/shared/entity-id";
import { unwrap } from "../../domain/shared/test-support";
import { COMMANDS } from "./command-constants";
import {
  getAppSettings,
  getSheetViewport,
  saveSheetViewport,
  setAutoSave,
  setLanguagePreference,
  setProjectTreeWidth,
  setThemePreference,
} from "./local-state-client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const projectId = unwrap(
  parseProjectId("01928f3a-5b6c-7d8e-9f01-23456789abcd"),
);
const documentId = unwrap(
  parseDocumentId("01928f3a-6c7d-7e8f-a012-3456789abcde"),
);
const sheetId = unwrap(parseSheetId("01928f3a-7d8e-7f90-b123-456789abcdef"));
const ISSUE = { kind: "invalidJson", detail: "expected value at line 1" };

beforeEach(() => {
  invokeMock.mockReset();
});

describe("getAppSettings", () => {
  it("decodes the settings", async () => {
    invokeMock.mockResolvedValueOnce({
      themePreference: "dark",
      languagePreference: "system",
      autoSave: false,
      projectTreeWidth: 400,
      loadIssue: null,
    });
    expect(await getAppSettings()).toStrictEqual({
      ok: true,
      value: {
        themePreference: "dark",
        languagePreference: "system",
        autoSave: false,
        projectTreeWidth: 400,
        loadIssue: null,
      },
    });
    expect(invokeMock.mock.calls).toStrictEqual([
      [COMMANDS.getAppSettings, {}],
    ]);
  });

  it("passes a load issue through next to the default", async () => {
    invokeMock.mockResolvedValueOnce({
      themePreference: "system",
      languagePreference: "system",
      autoSave: true,
      projectTreeWidth: 320,
      loadIssue: ISSUE,
    });
    expect(await getAppSettings()).toStrictEqual({
      ok: true,
      value: {
        themePreference: "system",
        languagePreference: "system",
        autoSave: true,
        projectTreeWidth: 320,
        loadIssue: ISSUE,
      },
    });
  });

  it("rejects malformed payloads as invalidCommandResponse", async () => {
    const valid = {
      themePreference: "system",
      languagePreference: "system",
      autoSave: true,
      projectTreeWidth: 320,
      loadIssue: null,
    };
    const malformed: unknown[] = [
      null,
      { themePreference: "system", loadIssue: null },
      { ...valid, autoSave: "yes" },
      { ...valid, themePreference: "sepia" },
      { ...valid, loadIssue: { kind: "nope", detail: "d" } },
      { ...valid, themePreference: 1 },
      { ...valid, languagePreference: "fr" },
      { ...valid, languagePreference: undefined },
      { ...valid, projectTreeWidth: undefined },
      { ...valid, projectTreeWidth: "320" },
      { ...valid, projectTreeWidth: 159 },
      { ...valid, projectTreeWidth: 641 },
      { ...valid, projectTreeWidth: 320.5 },
    ];
    for (const payload of malformed) {
      invokeMock.mockResolvedValueOnce(payload);
      const result = await getAppSettings();
      expect(result.ok, JSON.stringify(payload)).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalidCommandResponse");
    }
  });
});

describe("setThemePreference", () => {
  it("sends the preference and decodes the settings", async () => {
    invokeMock.mockResolvedValueOnce({
      themePreference: "light",
      languagePreference: "system",
      autoSave: true,
      projectTreeWidth: 320,
      loadIssue: null,
    });
    const result = await setThemePreference("light");
    expect(result.ok && result.value.themePreference).toBe("light");
    expect(invokeMock.mock.calls).toStrictEqual([
      [COMMANDS.setThemePreference, { themePreference: "light" }],
    ]);
  });

  it("returns Rust errors as they are", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "invalidThemePreference",
      detail: "d",
    });
    expect(await setThemePreference("dark")).toStrictEqual({
      ok: false,
      error: { kind: "invalidThemePreference", detail: "d" },
    });
  });
});

describe("setLanguagePreference", () => {
  it("sends the preference and decodes the settings", async () => {
    invokeMock.mockResolvedValueOnce({
      themePreference: "system",
      languagePreference: "ja",
      autoSave: true,
      projectTreeWidth: 320,
      loadIssue: null,
    });
    const result = await setLanguagePreference("ja");
    expect(result.ok && result.value.languagePreference).toBe("ja");
    expect(invokeMock.mock.calls).toStrictEqual([
      [COMMANDS.setLanguagePreference, { languagePreference: "ja" }],
    ]);
  });

  it("returns Rust errors as they are", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "invalidLanguagePreference",
      detail: "d",
    });
    expect(await setLanguagePreference("en")).toStrictEqual({
      ok: false,
      error: { kind: "invalidLanguagePreference", detail: "d" },
    });
  });
});

describe("getSheetViewport", () => {
  it("decodes an absent and a present viewport", async () => {
    invokeMock.mockResolvedValueOnce({ viewport: null, loadIssue: null });
    expect(
      await getSheetViewport(projectId, documentId, sheetId),
    ).toStrictEqual({ ok: true, value: { viewport: null, loadIssue: null } });
    invokeMock.mockResolvedValueOnce({
      viewport: { panX: 1.5, panY: -2, zoom: 2 },
      loadIssue: null,
    });
    const result = await getSheetViewport(projectId, documentId, sheetId);
    expect(result.ok && result.value.viewport).toEqual({
      panX: 1.5,
      panY: -2,
      zoom: 2,
    });
    expect(invokeMock.mock.calls[0]).toStrictEqual([
      COMMANDS.getSheetViewport,
      { projectId, documentId, sheetId },
    ]);
  });

  it("rejects an out-of-range viewport in the response", async () => {
    invokeMock.mockResolvedValueOnce({
      viewport: { panX: 0, panY: 0, zoom: 100 },
      loadIssue: null,
    });
    const result = await getSheetViewport(projectId, documentId, sheetId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalidCommandResponse");
  });
});

describe("saveSheetViewport", () => {
  it("sends the ids and the viewport and returns null", async () => {
    invokeMock.mockResolvedValueOnce(null);
    const parsed = parseViewport({ panX: 1, panY: 2, zoom: 1 });
    if (!parsed.ok) throw new Error(parsed.error.detail);
    const viewport = parsed.value;
    expect(
      await saveSheetViewport(projectId, documentId, sheetId, viewport),
    ).toStrictEqual({ ok: true, value: null });
    expect(invokeMock.mock.calls).toStrictEqual([
      [
        COMMANDS.saveSheetViewport,
        { projectId, documentId, sheetId, viewport },
      ],
    ]);
  });
});

describe("setAutoSave", () => {
  it("sends the flag and decodes the settings", async () => {
    invokeMock.mockResolvedValueOnce({
      themePreference: "dark",
      languagePreference: "system",
      autoSave: false,
      projectTreeWidth: 320,
      loadIssue: null,
    });
    const result = await setAutoSave(false);
    expect(result.ok && result.value.autoSave).toBe(false);
    expect(invokeMock.mock.calls).toStrictEqual([
      [COMMANDS.setAutoSave, { enabled: false }],
    ]);
  });

  it("returns Rust errors as they are", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "ioError", detail: "d" });
    expect(await setAutoSave(true)).toStrictEqual({
      ok: false,
      error: { kind: "ioError", detail: "d" },
    });
  });
});

describe("setProjectTreeWidth", () => {
  it("sends the width and decodes the settings", async () => {
    invokeMock.mockResolvedValueOnce({
      themePreference: "dark",
      languagePreference: "system",
      autoSave: true,
      projectTreeWidth: 480,
      loadIssue: null,
    });
    const result = await setProjectTreeWidth(480);
    expect(result.ok && result.value.projectTreeWidth).toBe(480);
    expect(invokeMock.mock.calls).toStrictEqual([
      [COMMANDS.setProjectTreeWidth, { width: 480 }],
    ]);
  });

  it("returns Rust errors as they are", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "invalidProjectTreeWidth",
      detail: "d",
    });
    expect(await setProjectTreeWidth(10)).toStrictEqual({
      ok: false,
      error: { kind: "invalidProjectTreeWidth", detail: "d" },
    });
  });
});
