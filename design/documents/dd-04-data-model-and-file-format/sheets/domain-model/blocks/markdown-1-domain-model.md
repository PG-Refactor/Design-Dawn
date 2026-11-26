# Domain Model

| Entity | File | Key fields |
|---|---|---|
| Project | `project.json` | `projectId`, `name`, `childOrder` |
| Folder | `folder.json` | `folderId`, `name`, `childOrder` |
| Document | `document.json` | `documentId`, `name`, `sheetOrder` |
| Sheet | `sheet.json` | `sheetId`, `name`, `blocks` |
| Block | entry in `sheet.json` | `blockId`, `blockType`, `position`, `size`, `contentPath` |

- Every ID is a UUIDv7, fixed for the life of the entity
- Every JSON file carries `schemaVersion`
