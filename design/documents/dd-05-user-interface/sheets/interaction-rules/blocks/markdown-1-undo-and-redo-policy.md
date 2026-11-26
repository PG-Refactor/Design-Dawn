# Undo and Redo Policy

| Scope | Operations |
|---|---|
| Document history | Text edits; add, delete, move, resize and z-order of blocks; renaming documents and sheets; reordering sheets |
| Project tree history | Reorder, move into a folder, create, rename a folder |
| Not undoable (confirmed first) | Create or delete a sheet; delete a document or folder |

- One user operation is one step; a drag is one step when released
- History is kept per document and discarded when it closes
- A failed operation leaves the model and the history unchanged
