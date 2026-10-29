# fixtures/mermaid-gui

Mermaid sources for the common foundation of the Mermaid GUI editor (docs/architecture.md §16, Step 9-2). `sources.json` holds 32 cases; nothing here is read by Rust.

## Origin

- Selected from the Step 9-1 technical validation corpus: `vis9/spike/corpus.ts` in the archive `~/design-dawn-archive/phase9-step9-1/vis9-step9-1.tar.gz` (sha256 of `corpus.ts` in the archive manifest: `4fc0d2a5710d4820682b17d44edc10b4dccf23c984d65b841d5cdb89b7f999d0`).
- Validated against mermaid 12.1.0 at repository commit `3dda194` on 2026-10-11.
- Project-authored: the corpus inputs were written during our own spike and the failure cases below were written for this project. No file of the evaluated third-party package (`vis9/pkg/`) is copied; it was only a design reference.

## Selection (19 of the 47 corpus inputs, plus 13 new ones)

- 19 corpus inputs (`corpus-*`): the ones that stress detection and lossless scanning for all four types (CRLF, front matter, `%%{init}%%`, comments, blank lines, tabs and irregular whitespace, Japanese, legacy `graph`, and five that mermaid 12.1.0 rejects). The other corpus inputs differ only in diagram content, which is not needed before the per-type parsers exist.
- 2 new inputs (`own-*`) with emoji, because the corpus has none and offsets are UTF-16 code units.
- 11 minimal repros (`fail-*`) of the known failure cases of §16.12.3, one per case. Each has a `futureBehaviour` note: what a type parser or gate must do later. Today the tests only check detection, the lossless round trip and "not editable yet".

## Fields

`id`, `group` (`edgeCase` or `knownFailure`), `diagram` (`flowchart` `sequence` `pie` `gantt`, the type detection must report), `source` (exact text; `\r\n` is kept), `mermaidParses` (whether `mermaid.parse` accepts it in 12.1.0, checked by `src/features/mermaid/diagram-type.real.dom.test.ts`), `note`, and `futureBehaviour` for failure cases.

## flowchart-corpus.json (Step 9-6)

Input of the differential test of the flowchart reader (`src/features/mermaid/flowchart-reader.real.dom.test.ts`, docs/architecture.md §16.15.11). 472 cases: the 237 + 97 syntax cases of the Step 9-5 research (`c1:` `c2:`), its six reference diagrams (`R:`) and the text after each of its 132 hand-made edit scenarios (`cand:`; `skippedScenarios` is 0, none of the edits failed).

- Origin: the Step 9-5 research archive `~/design-dawn-archive/phase9-step9-5/` (`fc95-step9-5.tar.gz`, SHA-256 `9fc52f57a3e9736f5e5562dcb58c0ecb228002e210697b59f2319f12a9a073b4`; `spike/corpus.ts`, `corpus2.ts`, `scenarios.ts`, `edit-lib.ts`). Generated once on 2026-10-12 by a throw-away script (not in the repository).
- Project-authored research input: no third-party code or corpus is included.
- Fields: `id` (origin prefix kept), `group`, `source`, `note` (the corpus author's expectation in words, informal).
- The expected results are not stored: Mermaid 12.1.0 is the reference and decides at test time. The test asserts recorded counts, so a change in Mermaid or in the reader shows up as a failure.
