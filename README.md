# Design Dawn

**English** | [日本語](README.ja.md)

Design Dawn is a desktop application for writing design documents on an infinite canvas.
A document is a set of sheets; each sheet holds freely placed blocks of **Markdown**, **Mermaid
diagrams** and **images**. Everything is stored as ordinary files and folders, so the same project
can be read and edited by people, reviewed with Git, and changed safely by AI tools.

![A design document with Markdown and a Mermaid flowchart on the canvas](assets/screenshots/overview-dark.png)

> **Status**: pre-release, developed and tested on Linux (WSL2 + WSLg). Windows and macOS builds
> have not been verified yet.

## Features

- **Infinite canvas** — pan, zoom, select, move, resize, align, z-order, copy/paste, and undo/redo
  for every edit.
- **Project → Document → Sheet → Block** — a project tree with folders, document tabs and sheet
  tabs; several documents (and windows) open at once.
- **Markdown blocks** — rendered view on the canvas; a split source/preview editor while editing.
- **Mermaid blocks** — any Mermaid 12 diagram, rendered locally and sanitised (no network, no
  scripts).
- **Mermaid GUI editor** — edit pie charts, flowcharts, sequence diagrams and gantt charts with
  lists and property fields instead of syntax. The Mermaid source stays the single source of
  truth: each GUI edit changes only the bytes it must, is checked by re-reading the result and
  rendering it, and is one undo step. Anything the editor does not fully understand stays
  read-only rather than being rewritten.
- **Image blocks** — PNG, JPEG, WebP, SVG and GIF, added by drag and drop.
- **Git integration** — status, stage/unstage, commit, history, side-by-side diffs in tabs,
  discard, fetch/pull/push, branch display.
- **External changes** — edits made by another editor, Git or an AI tool are detected; documents
  without unsaved work reload automatically, otherwise you choose to reload, keep your version or
  compare.
- **AI / MCP** — `design-dawn-mcp`, a local MCP server (stdio only, read-only by default) that lets
  AI clients such as Claude Code read and edit documents, sheets and blocks.
- **Load issue repair and format migration** — inconsistencies found when a project is opened
  (missing or unlisted items, duplicate IDs, orphan files, leftovers of an interrupted save) can be
  repaired from the notification panel; files written by older versions are read and upgraded on
  the next save.
- **Light / dark theme** and **English / Japanese** UI, with a compact File / View / Help menu bar (version and license information under Help).

| Flowchart GUI editor | Sequence diagram GUI editor |
|---|---|
| ![Flowchart editor with node list and property panel](assets/screenshots/flowchart-gui.png) | ![Sequence diagram editor with participants and messages](assets/screenshots/sequence-gui.png) |

| Markdown editing | Git diff |
|---|---|
| ![Markdown block in split source/preview mode](assets/screenshots/markdown-edit.png) | ![Side-by-side Git diff of a Markdown block](assets/screenshots/git-diff.png) |

| Gantt and pie charts | Light theme |
|---|---|
| ![Gantt chart and pie chart on a sheet](assets/screenshots/plan.png) | ![The overview sheet in the light theme](assets/screenshots/light-theme.png) |

## How a project is stored

```text
my-project/
├── project.json                  # project name and document order
├── system-design.dawn            # entry point that opens a document from the file manager
└── documents/
    └── system-design/
        ├── document.json         # sheet order
        ├── assets/               # images
        └── sheets/
            └── overview/
                ├── sheet.json    # block positions, sizes and types
                └── blocks/
                    ├── markdown-1.md
                    └── mermaid-1.mmd
```

Layout lives in small JSON files and content lives in `.md` / `.mmd` files, so diffs stay readable
and a human or an AI can change one block without touching the rest. Every JSON file carries a
`schemaVersion`; IDs are stable UUIDs, and display names are independent of folder names.

## Building and running

Development happens entirely inside a dev container; nothing but Docker is needed on the host.

**Prerequisites**: Linux, or Windows 11 with WSL2 (WSLg enabled), and Docker (Docker Desktop with
the WSL2 backend on Windows). Clone the repository onto the Linux / WSL2 file system.

```sh
docker compose build                 # build the dev image
docker compose up -d                 # start the dev container
docker compose exec dev npm ci       # install dependencies
docker compose exec dev npm run tauri dev   # run the app; the window appears through WSLg / X11
```

Other commands:

```sh
docker compose exec dev npm run verify   # typecheck, Biome, Vitest, license check, cargo fmt/clippy/test
docker compose exec dev npm run build    # frontend production build
docker compose exec dev npm run tauri build -- --bundles deb   # Linux package
```

Notes:

- `node_modules` and the Rust build output live on Docker named volumes, not in the source tree.
- The window is shown through WSLg X11 (`GDK_BACKEND=x11` in `compose.yaml`).
- If the repository is bind-mounted from a Windows drive, set `DAWN_WATCH_POLLING=true`, because
  file change events may not arrive there.

## Using it with AI (MCP)

```sh
docker compose exec dev cargo build --release --manifest-path src-tauri/Cargo.toml --bin design-dawn-mcp
claude mcp add design-dawn -- /path/to/design-dawn-mcp --project /path/to/my-project
```

The server speaks MCP over stdin/stdout only and works whether or not the app is running.

- **Read tools**: `getProject`, `getDocument`, `getSheet`, `getBlock`.
- **Write tools** (only with `--allow-write`): `createDocument`, `createSheet`, `createBlock`
  (Markdown or Mermaid), `updateDocument`, `updateSheet`, `updateBlock`, `moveBlock`, `deleteBlock`.
- To change a block's text, read it with `getBlock` and pass its `contentHash` as
  `expectedContentHash`; if the text changed in the meantime the call returns `conflict`.
- It cannot delete documents, sheets or projects, import files from disk, run commands, use Git or
  open network connections. If the app has the project open, it picks the changes up as external
  changes.

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "design-dawn": {
      "command": "/path/to/design-dawn-mcp",
      "args": ["--project", "/path/to/my-project"]
    }
  }
}
```

## License

Design Dawn is released under the [MIT License](LICENSE). Third-party licenses of the bundled
dependencies are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
