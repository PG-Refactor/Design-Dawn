// What the user pastes into an AI tool to register the MCP server. Only the command: the
// server follows the app, so no Project and no permission go into the registration.

import { AI_ACCESS_CONFIG } from "../../config/ai-access-config";

const JSON_INDENT = 2;

// The common `mcpServers` form many AI tools read (Claude Desktop, Cursor and others).
export function mcpServersJson(commandPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [AI_ACCESS_CONFIG.serverName]: { command: commandPath },
      },
    },
    null,
    JSON_INDENT,
  );
}
