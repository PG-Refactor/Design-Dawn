import { describe, expect, it } from "vitest";
import rustCommands from "../../../src-tauri/src/commands/mod.rs?raw";
import { COMMANDS } from "./command-constants";

const COMMAND_NAMES_PATTERN = /COMMAND_NAMES: \[&str; \d+\] = \[([^\]]*)\]/;
const QUOTED_NAME_PATTERN = /"([a-z_]+)"/g;

describe("command contract with Rust", () => {
  it("lists exactly the commands Rust exposes", () => {
    const block = COMMAND_NAMES_PATTERN.exec(rustCommands)?.[1] ?? "";
    const rustNames = [...block.matchAll(QUOTED_NAME_PATTERN)]
      .map((match) => match[1])
      .sort();
    expect(rustNames.length).toBeGreaterThan(0);
    expect(Object.values(COMMANDS).sort()).toEqual(rustNames);
  });
});
