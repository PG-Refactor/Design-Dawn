# Security Controls

| ID | Control |
|---|---|
| SEC-01 | Mermaid rendered locally at its strict security level; SVG output sanitised |
| SEC-02 | Raw HTML in Markdown shown as text; links not opened by the application |
| SEC-03 | No network access for rendering |
| SEC-04 | MCP server on standard input and output only; no network port |
| SEC-05 | AI access limited to listed projects; read-only until allowed |
| SEC-06 | AI access list kept outside projects, so a project cannot grant itself access |
| SEC-07 | Paths validated in Rust before any file access |
