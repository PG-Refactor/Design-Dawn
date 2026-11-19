// The AI integration (MCP) values shown to the user.

export const AI_ACCESS_CONFIG = {
  // The name the MCP server is registered under in an AI tool's configuration.
  serverName: "design-dawn",
  // How long "Copied" stays next to a copy button.
  copiedNoticeMs: 2000,
  // How long an AI's request (to edit, to add an image) waits for an answer: the app drops
  // it after this (`AI_REQUEST_MAX_AGE_SECS` in Rust), so its question closes too.
  requestLifetimeMs: 120_000,
} as const;
