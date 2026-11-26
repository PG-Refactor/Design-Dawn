# Layered Architecture

## Principles
- No direct file system access from the React UI
- File system, file watching and Git isolated in Rust
- Rust as the only writer of file formats
- Invariants validated again in Rust (the TypeScript side is not trusted)
- Use cases separated from the UI, so the same operations serve the MCP server

## Responsibilities
| Concern | TypeScript | Rust |
|---|---|---|
| Rendering and input | Yes | |
| In-memory model, undo and redo | Yes | |
| File reading and writing | | Yes |
| File watching, Git | | Yes |
| Validation of invariants | Early check | Final check |
