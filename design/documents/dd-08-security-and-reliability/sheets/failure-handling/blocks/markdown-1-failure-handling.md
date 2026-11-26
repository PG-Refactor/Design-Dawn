# Failure Handling

| Situation | Behaviour |
|---|---|
| Save fails | Model and undo history kept as they were; the error is shown with a retry |
| Interrupted save | Previous file intact; leftovers reported and repairable when the project opens |
| Inconsistent project (missing or unlisted items, duplicate IDs, orphan files) | Reported in the notification panel, with repair actions |
| File changed elsewhere | Not overwritten; reload, keep or compare (DD-07) |
| Newer file format | Refused before its content is interpreted |
