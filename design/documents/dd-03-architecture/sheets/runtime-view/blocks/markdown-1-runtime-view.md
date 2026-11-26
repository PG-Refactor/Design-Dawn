# Runtime View

| Component | Description |
|---|---|
| Desktop application | Tauri 2: web view for the UI, Rust for native work |
| MCP server (`design-dawn-mcp`) | Separate executable built from the same Rust code; stdio only; runs without the application |
| Project folder | Shared by the application and the MCP server |
| AI access list (`ai-access.json`) | In the application settings folder, never inside a project; shared by both |

- Changes written by the MCP server reach an open application through file watching
