# Versioning and Persistence

## Versioning
- Older `schemaVersion` files migrated on load
- Newer, unknown versions refused before their content is interpreted

## Persistence Rules
- Each file written to a temporary file, then replaced (atomic write)
- Body files written before metadata files
- Hash of the content last read or written kept per file
- A file that differs from that hash is not overwritten; the user is told
- Saves of one document run one at a time
