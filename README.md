# Design Dawn

Design Dawn is a desktop design document application built with Tauri 2, React, TypeScript, Vite and Rust.
Documents are stored as plain files and folders (Markdown, Mermaid, images, small JSON metadata) so that humans, Git and AI tools can all work with them directly.

Design and rules live in [`docs/`](docs/README.md) and [`.claude/CLAUDE.md`](.claude/CLAUDE.md). Current status: Phase 0 (development environment only; no features yet).

## Prerequisites

- Windows 11 with WSL2 (WSLg enabled)
- Docker Desktop using the WSL2 backend

Nothing else is installed on the host. Node.js, Rust and all dependencies live in the dev container ([`docs/environment.md`](docs/environment.md)).

## Setup

The repository lives on the WSL2 filesystem (`~/GitHub/PG-Refactor/Design-Dawn` in the Ubuntu-22.04 distro). Run everything from a shell inside that distro (Docker Desktop WSL integration must be enabled for it).

```sh
docker compose build          # build the dev image
docker compose up -d          # start the dev container
docker compose exec dev npm ci
```

## Daily commands

```sh
docker compose exec dev npm run verify      # typecheck, biome, vitest, cargo fmt/clippy/test
docker compose exec dev npm run build       # frontend production build
docker compose exec dev npm run tauri dev   # run the app; the window appears through WSLg
```

Other scripts: `typecheck`, `lint`, `format`, `format:check`, `check`, `test`, `rust:fmt:check`, `rust:lint`, `rust:test` (see `package.json`).
One-off commands also work without a running container: `docker compose run --rm dev <command>`.

`compose.yaml` sets `GDK_BACKEND=x11` because the window is verified through WSLg X11 (XWayland); the native Wayland path is untested. To try Wayland:

```sh
docker compose exec -e GDK_BACKEND=wayland dev npm run tauri dev
```

## Notes

- `node_modules`, `src-tauri/target` and the Cargo/npm caches live on Docker named volumes, not in the source tree. `cargo clean` reports "Device or resource busy" because `src-tauri/target` is a mount point (its contents are still removed).
- WSLg sockets are mounted from `WSLG_DIR` (default `/mnt/wslg`, correct when compose runs inside the distro). If you ever run compose from Windows instead, set `WSLG_DIR=/run/desktop/mnt/host/wslg`; if the repository is bind-mounted from `C:\`, also set `DAWN_WATCH_POLLING=true` because file change events may not arrive.
- `npm ci` must be re-run after the `node_modules` volume is removed (`docker compose down -v`).
- Windows native builds (MSVC / WebView2) are out of scope for Phase 0.
