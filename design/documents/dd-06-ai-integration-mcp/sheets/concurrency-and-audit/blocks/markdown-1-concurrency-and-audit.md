# Concurrency and Audit

- `updateBlock` requires the `contentHash` returned when the block was read
- A different hash on disk means someone changed the block: nothing is written, the result is `conflict`
- The AI reads the block again and redoes the change on the new text
- An open application shows the change at once (file watching)
