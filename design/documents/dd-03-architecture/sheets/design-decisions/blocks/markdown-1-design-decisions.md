# Design Decisions

| ID | Decision | Rationale | Consequence |
|---|---|---|---|
| DEC-01 | Plain files instead of a database or one large JSON | Readable without the application; reviewable diffs | Many small files per document |
| DEC-02 | Rust is the only writer of file formats | One place for serialization, validation and atomic writes | Every write goes through a Tauri command |
| DEC-03 | Undo and redo as a history of Application Commands | Meaningful steps, independent of UI events; reusable by non-UI callers | Each operation defines do and undo |
| DEC-04 | No relationships between blocks | Each `.md` and `.mmd` file stays complete on its own | Relationships drawn in Mermaid or written in text |
| DEC-05 | Mermaid source as the single source of truth for the GUI editor | Hand-written and AI-written diagrams stay editable | Unsupported syntax opens read-only |
| DEC-06 | MCP over stdio with content-hash checks | No network exposure; no lost updates | AI re-reads and retries on conflict |
