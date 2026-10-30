import { describe, expect, it } from "vitest";

// Dependency direction (docs/architecture.md §2, CLAUDE.md §14): domain and application
// know nothing about React, Tauri, infrastructure or features.
const sources = import.meta.glob(
  ["./domain/**/*.ts", "./application/**/*.ts"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
const FORBIDDEN_PACKAGES = ["react", "react-dom", "@tauri-apps"];
const FORBIDDEN_PATH_PARTS = ["/infrastructure/", "/features/"];

function violation(specifier: string): string | null {
  const forbiddenPackage = FORBIDDEN_PACKAGES.find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
  if (forbiddenPackage !== undefined) return `package ${forbiddenPackage}`;
  const forbiddenPath = FORBIDDEN_PATH_PARTS.find((part) =>
    `/${specifier}/`.includes(part),
  );
  return forbiddenPath === undefined ? null : `path ${forbiddenPath}`;
}

describe("architecture guard", () => {
  it("scans the domain and application sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it("keeps domain and application free of React, Tauri, infrastructure and features", () => {
    const violations: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
        const reason = violation(match[1] ?? "");
        if (reason !== null)
          violations.push(`${file} imports ${match[1]} (${reason})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("detects forbidden specifiers", () => {
    expect(violation("react")).not.toBeNull();
    expect(violation("@tauri-apps/api/core")).not.toBeNull();
    expect(violation("../infrastructure/tauri/x")).not.toBeNull();
    expect(
      violation("../../features/workspace/ui-state/ui-state"),
    ).not.toBeNull();
    expect(violation("../domain/shared/brand")).toBeNull();
    expect(violation("vitest")).toBeNull();
  });
});

// The diagram model is pure text processing: it must stay usable by Node tests and by
// every layer, so it may not reach upward or pull in the Mermaid library (docs/architecture.md §16.6).
describe("diagram domain guard", () => {
  const diagramFiles = Object.entries(sources).filter(([file]) =>
    file.startsWith("./domain/diagram/"),
  );
  const DIAGRAM_FORBIDDEN_PATH_PARTS = [
    "/application/",
    "/features/",
    "/infrastructure/",
  ];

  function diagramViolation(specifier: string): string | null {
    if (specifier === "mermaid" || specifier.startsWith("mermaid/")) {
      return "package mermaid";
    }
    const forbiddenPath = DIAGRAM_FORBIDDEN_PATH_PARTS.find((part) =>
      `/${specifier}/`.includes(part),
    );
    return forbiddenPath === undefined ? null : `path ${forbiddenPath}`;
  }

  it("scans the diagram domain sources", () => {
    expect(diagramFiles.length).toBeGreaterThan(3);
  });

  it("imports nothing from application, features, infrastructure or mermaid", () => {
    const violations: string[] = [];
    for (const [file, source] of diagramFiles) {
      for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
        const reason = diagramViolation(match[1] ?? "");
        if (reason !== null)
          violations.push(`${file} imports ${match[1]} (${reason})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("detects forbidden specifiers", () => {
    expect(diagramViolation("mermaid")).not.toBeNull();
    expect(
      diagramViolation("../../application/commands/command"),
    ).not.toBeNull();
    expect(diagramViolation("../../features/mermaid/x")).not.toBeNull();
    expect(diagramViolation("./source-lines")).toBeNull();
    expect(diagramViolation("../shared/domain-result")).toBeNull();
  });
});

// UI code (features and the app's React components) reaches the application layer only;
// the infrastructure is wired in exactly one place, the composition root. main.tsx sits
// outside these folders and imports no infrastructure either.
const uiSources = import.meta.glob(
  ["./features/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const COMPOSITION_ROOT_FILES = ["./app/create-app-services.ts"];
const UI_FORBIDDEN_PACKAGES = ["@tauri-apps"];
const UI_FORBIDDEN_PATH_PARTS = ["/infrastructure/"];

function isProductionUiFile(file: string): boolean {
  return !/\.test\.tsx?$/.test(file) && !file.includes("/test-support/");
}

function uiViolation(specifier: string): string | null {
  const forbiddenPackage = UI_FORBIDDEN_PACKAGES.find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
  if (forbiddenPackage !== undefined) return `package ${forbiddenPackage}`;
  const forbiddenPath = UI_FORBIDDEN_PATH_PARTS.find((part) =>
    `/${specifier}/`.includes(part),
  );
  return forbiddenPath === undefined ? null : `path ${forbiddenPath}`;
}

describe("UI architecture guard", () => {
  const files = Object.entries(uiSources).filter(([file]) =>
    isProductionUiFile(file),
  );

  it("scans the UI sources", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some(([file]) => file.endsWith(".tsx"))).toBe(true);
    for (const root of COMPOSITION_ROOT_FILES) {
      expect(Object.keys(uiSources)).toContain(root);
    }
  });

  it("keeps components and UI modules away from infrastructure and Tauri", () => {
    const violations: string[] = [];
    for (const [file, source] of files) {
      if (COMPOSITION_ROOT_FILES.includes(file)) continue;
      for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
        const reason = uiViolation(match[1] ?? "");
        if (reason !== null)
          violations.push(`${file} imports ${match[1]} (${reason})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("really needs the composition root exception", () => {
    const root = uiSources[COMPOSITION_ROOT_FILES[0] ?? ""] ?? "";
    expect(
      [...root.matchAll(IMPORT_SPECIFIER_PATTERN)].some(
        (match) => uiViolation(match[1] ?? "") !== null,
      ),
    ).toBe(true);
  });

  it("detects forbidden specifiers", () => {
    expect(uiViolation("../../infrastructure/tauri/x")).not.toBeNull();
    expect(uiViolation("@tauri-apps/api/core")).not.toBeNull();
    expect(uiViolation("../../application/workspace/workspace")).toBeNull();
    expect(uiViolation("react")).toBeNull();
  });
});

// Tauri's built-in drag-drop events carry absolute paths, and an event listener is the only
// way a script could read them. The capability grants no `core:event` permission, and no
// frontend code may depend on events: drop notifications use an IPC channel instead.
const allSources = import.meta.glob(["./**/*.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FORBIDDEN_EVENT_PACKAGE = "@tauri-apps/api/event";
const BUILTIN_DRAG_EVENT_PREFIX = "tauri://drag";

describe("Tauri event guard", () => {
  const files = Object.entries(allSources).filter(([file]) =>
    isProductionUiFile(file),
  );

  it("scans the production sources", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(
      files.some(([file]) => file.endsWith("tauri-drop-event-source.ts")),
    ).toBe(true);
  });

  it("never imports the Tauri event API or names a built-in drag event", () => {
    const violations: string[] = [];
    for (const [file, source] of files) {
      if (source.includes(FORBIDDEN_EVENT_PACKAGE))
        violations.push(`${file} mentions ${FORBIDDEN_EVENT_PACKAGE}`);
      if (source.includes(BUILTIN_DRAG_EVENT_PREFIX))
        violations.push(`${file} mentions ${BUILTIN_DRAG_EVENT_PREFIX}`);
    }
    expect(violations).toEqual([]);
  });
});
