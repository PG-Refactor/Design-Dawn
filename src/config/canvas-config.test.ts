import { describe, expect, it } from "vitest";
import mcpConfigSource from "../../src-tauri/src/mcp/config.rs?raw";
import { CANVAS_CONFIG } from "./canvas-config";

function rustConstant(name: string): number {
  const match = new RegExp(`pub const ${name}: i64 = (\\d+);`).exec(
    mcpConfigSource,
  );
  return Number(match?.[1]);
}

describe("canvas config", () => {
  it("gives AI (the MCP server) the same smallest Block as resizing in the app", () => {
    expect(rustConstant("BLOCK_MIN_WIDTH")).toBe(
      CANVAS_CONFIG.block.minSize.width,
    );
    expect(rustConstant("BLOCK_MIN_HEIGHT")).toBe(
      CANVAS_CONFIG.block.minSize.height,
    );
  });
});
