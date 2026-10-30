# Design Dawn

**English** | [日本語](README.ja.md)

Design Dawn is a desktop application for writing design documents on an infinite canvas.
A document is a set of sheets; each sheet holds freely placed blocks of **Markdown**, **Mermaid
diagrams** and **images**. Everything is stored as ordinary files and folders, so the same project
can be read and edited by people, reviewed with Git, and changed safely by AI tools.

![A design document with Markdown and a Mermaid flowchart on the canvas](docs/images/overview-dark.png)

> **Status**: pre-release, developed and tested on Linux (WSL2 + WSLg). Windows and macOS builds
> have not been verified yet. See [`docs/development-state.md`](docs/development-state.md).

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
- **Light / dark theme** and **English / Japanese** UI.

| Flowchart GUI editor | Sequence diagram GUI editor |
|---|---|
| ![Flowchart editor with node list and property panel](docs/images/flowchart-gui.png) | ![Sequence diagram editor with participants and messages](docs/images/sequence-gui.png) |

| Markdown editing | Git diff |
|---|---|
| ![Markdown block in split source/preview mode](docs/images/markdown-edit.png) | ![Side-by-side Git diff of a Markdown block](docs/images/git-diff.png) |

| Gantt and pie charts | Light theme |
|---|---|
| ![Gantt chart and pie chart on a sheet](docs/images/plan.png) | ![The overview sheet in the light theme](docs/images/light-theme.png) |

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
and a human or an AI can change one block without touching the rest. The full format is in
[`docs/file-format.md`](docs/file-format.md).

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

Details, including WSLg notes and known limitations, are in
[`docs/environment.md`](docs/environment.md).

## Using it with AI (MCP)

```sh
docker compose exec dev cargo build --release --manifest-path src-tauri/Cargo.toml --bin design-dawn-mcp
claude mcp add design-dawn -- /path/to/design-dawn-mcp --project /path/to/my-project
```

The server is read-only unless started with `--allow-write`. It cannot delete documents or sheets,
run commands, use Git or open network connections. See [`docs/mcp.md`](docs/mcp.md).

## Documentation

Design and rules live in [`docs/`](docs/README.md): requirements, architecture, data model, file
format, UI design, security, testing and the roadmap.

## License

The license of Design Dawn itself has not been chosen yet. Third-party licenses of the bundled
dependencies are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
