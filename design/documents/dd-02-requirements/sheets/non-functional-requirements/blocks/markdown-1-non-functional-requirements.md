# Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Data integrity | Atomic writes; an interrupted save leaves the previous file intact |
| NFR-02 | Data integrity | No silent overwrite of a change made outside the application |
| NFR-03 | Transparency | Every file readable and editable in a text editor (images excepted) |
| NFR-04 | Diff-friendliness | Small, local diffs; stable IDs that survive renaming |
| NFR-05 | Security | No network access for rendering; no network port for AI access |
| NFR-06 | Offline operation | No account, cloud service or paid API required |
| NFR-07 | Portability | Windows 11 (64-bit) build; Linux from source |
| NFR-08 | Usability | Light and dark themes; English and Japanese UI |
| NFR-09 | Maintainability | Layered design; named constants instead of hard-coded values |
