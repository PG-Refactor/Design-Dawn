import { version } from "../../package.json";

export const APP_CONFIG = {
  displayName: "Design Dawn",
  rootElementId: "root",
  // package.json is the version that is shown; tauri.conf.json and Cargo.toml must carry
  // the same one (checked by a test), because installers and the MCP server report theirs.
  version,
  licenseName: "MIT License",
} as const;
