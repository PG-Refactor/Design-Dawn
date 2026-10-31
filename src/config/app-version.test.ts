import { describe, expect, it } from "vitest";
import cargoToml from "../../src-tauri/Cargo.toml?raw";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import { APP_CONFIG } from "./app-config";

// The version line of the [package] table (the first `version =` of the file).
const CARGO_VERSION_PATTERN = /^version\s*=\s*"([^"]+)"/m;

describe("app version", () => {
  it("is the same in package.json, tauri.conf.json and Cargo.toml", () => {
    expect(APP_CONFIG.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(tauriConfig.version).toBe(APP_CONFIG.version);
    expect(cargoToml.match(CARGO_VERSION_PATTERN)?.[1]).toBe(
      APP_CONFIG.version,
    );
  });
});
