# Block Record (`sheet.json` → `blocks[]`)

| Field | Type | Required | Description |
|---|---|---|---|
| `blockId` | UUIDv7 | Yes | Stable identity of the block |
| `blockType` | `markdown` / `mermaid` / `image` | Yes | Kind of block |
| `position` | `{ x, y }` integers | Yes | Top-left corner in world units |
| `size` | `{ width, height }` integers | Yes | Size in world units |
| `contentPath` | relative path | Yes | Body file (`.md`, `.mmd`) or image in `assets/` |
| `caption` | string | No | One-line caption of a diagram or image |
| `captionPosition` | `above` / `below` | No | Where the caption is shown |
| `contentScalePercent` | integer | No | Display scale of the content |
| `autoFit` | boolean | No | Fit the content to the block |

- Array order is the stacking order (z-order)
