import { describe, expect, it } from "vitest";
import { toAiAccessOverviewResult } from "./ai-access-client";

const PROJECT_ID = "01928f3a-0000-7000-8000-000000000001";

function payload(overrides: Record<string, unknown> = {}): unknown {
  return {
    mcpServer: { displayPath: "C:\\Apps\\design-dawn-mcp.exe", found: true },
    projects: [
      {
        projectId: PROJECT_ID,
        name: "Order",
        folderDisplay: "C:\\work\\order",
        allowWrite: false,
        current: true,
      },
    ],
    openProject: { projectId: PROJECT_ID, listed: true },
    loadIssue: null,
    ...overrides,
  };
}

describe("toAiAccessOverviewResult", () => {
  it("accepts what Rust sends", () => {
    const result = toAiAccessOverviewResult(payload());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.projects[0]?.projectId).toBe(PROJECT_ID);
  });

  it("refuses a malformed Project id or a missing field as a bad response", () => {
    for (const bad of [
      payload({
        projects: [
          {
            projectId: "../x",
            name: null,
            folderDisplay: "",
            allowWrite: false,
            current: false,
          },
        ],
      }),
      payload({ mcpServer: { displayPath: "x" } }),
      payload({ loadIssue: { kind: "notAKind", detail: "" } }),
      payload({ openProject: { projectId: "x", listed: false } }),
    ]) {
      const result = toAiAccessOverviewResult(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalidCommandResponse");
    }
  });
});
