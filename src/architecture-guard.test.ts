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
