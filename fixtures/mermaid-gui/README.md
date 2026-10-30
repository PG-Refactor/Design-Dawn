# fixtures/mermaid-gui

Mermaid sources for the common foundation of the Mermaid GUI editor. `sources.json` holds 32 cases; nothing here is read by Rust.

## Origin

- Selected from the project's technical validation corpus (a research corpus that is not included in the repository).
- Validated against mermaid 12.1.0.
- Project-authored: the corpus inputs were written during the project's own validation work and the failure cases below were written for this project. No file of any evaluated third-party package is copied.

## Selection (19 of the 47 corpus inputs, plus 13 new ones)

- 19 corpus inputs (`corpus-*`): the ones that stress detection and lossless scanning for all four types (CRLF, front matter, `%%{init}%%`, comments, blank lines, tabs and irregular whitespace, Japanese, legacy `graph`, and five that mermaid 12.1.0 rejects). The other corpus inputs differ only in diagram content, which is not needed before the per-type parsers exist.
- 2 new inputs (`own-*`) with emoji, because the corpus has none and offsets are UTF-16 code units.
- 11 minimal repros (`fail-*`) of known failure cases, one per case. Each has a `futureBehaviour` note: what a type parser or gate must do later. Today the tests only check detection, the lossless round trip and "not editable yet".

## Fields

`id`, `group` (`edgeCase` or `knownFailure`), `diagram` (`flowchart` `sequence` `pie` `gantt`, the type detection must report), `source` (exact text; `\r\n` is kept), `mermaidParses` (whether `mermaid.parse` accepts it in 12.1.0, checked by `src/features/mermaid/diagram-type.real.dom.test.ts`), `note`, and `futureBehaviour` for failure cases.

## flowchart-corpus.json

Input of the differential test of the flowchart reader (`src/features/mermaid/flowchart-reader.real.dom.test.ts`). 472 cases: the 237 + 97 syntax cases of the flowchart research (`c1:` `c2:`), its six reference diagrams (`R:`) and the text after each of its 132 hand-made edit scenarios (`cand:`; `skippedScenarios` is 0, none of the edits failed).

- Origin: the project's flowchart research corpus (not included in the repository). Generated once by a throw-away script (not in the repository).
- Project-authored research input: no third-party code or corpus is included.
- Fields: `id` (origin prefix kept), `group`, `source`, `note` (the corpus author's expectation in words, informal).
- The expected results are not stored: Mermaid 12.1.0 is the reference and decides at test time. The test asserts recorded counts, so a change in Mermaid or in the reader shows up as a failure.

## flowchart-scenarios.json

The Tier 1 edit scenarios of the flowchart editor (`src/features/mermaid/flowchart-operations.real.dom.test.ts`). 91 scenarios: the ones of the 132 hand-made edit scenarios of the flowchart research that concern a Tier 1 operation (label, shape, add node, add edge, delete edge, reconnect, edge kind / label, direction). The scenarios about subgraph edits, renaming ids, deleting nodes, reordering and `classDef` / `click` values (Tier 2 and later: the structural edits that come after the basic ones) are not included.

- Origin: the project's flowchart research corpus (not included in the repository). Generated once by a throw-away script (not in the repository) that applied each scenario's hand-made edits.
- Project-authored research input: no third-party code is included.
- Fields: `id` (the research id, e.g. `DE4-chain-naive`), `op` (the research's name for the operation), `source`, `naiveCandidate` (the text after the research's hand-made edit), `naiveGate` (how Mermaid and the research's comparison judged that text: `PASS`, `FAIL-parse`, `FAIL-render` or `FAIL-semantic`), `note` (the research's note).
- The product's operation for each scenario is in the test, not here: the intent of the scenario written as a typed `FlowchartOperation`, and whether the editor plans it or refuses it (with the reason). Where `naiveGate` is not `PASS` and the editor plans the operation, the test asserts that the naive text really differs from the promised meaning in Mermaid 12.1.0.

## sequence-corpus.json

Input of the differential test of the sequence reader (`src/features/mermaid/sequence-reader.real.dom.test.ts`). 580 cases: the 361 syntax cases of the sequence research (`SQ-<group>-<n>`) and the text before and after each of its 79 hand-made edit scenarios (`cand:<scenario>:before|naive|safe`; the `safe` text exists only for the scenarios whose research plan was not a refusal).

- Origin: the project's sequence research corpus (not included in the repository). Generated once by a throw-away script (not in the repository) that ran the corpus file and applied each scenario's hand-made edits.
- Project-authored research input: no third-party code or corpus is included.
- Fields: `id` (origin prefix kept), `group`, `source`, `note` (the corpus author's expectation in words, informal).
- The expected results are not stored: Mermaid 12.1.0 is the reference and decides at test time. The test asserts recorded counts, so a change in Mermaid or in the reader shows up as a failure.

## sequence-scenarios.json

The edit scenarios of the sequence editor (`src/features/mermaid/sequence-operations.real.dom.test.ts`). 79 scenarios: all the hand-made edit scenarios of the sequence research. The test has a typed `SequenceOperation` and an expected outcome (planned, or refused with a reason) for the 61 that concern a Tier 1 operation or a construct the editor treats as read-only; the others (deleting or reordering participants, swapping the direction, duplicating, wrapping, unwrapping, adding or deleting a branch, box edits) are Tier 2 and are not exercised.

- Origin: the same corpus and generation as `sequence-corpus.json`.
- Project-authored research input: no third-party code is included.
- Fields: `id` (the research id, e.g. `SQE-M11`), `op` (the research's name for the operation), `source`, `naiveCandidate` (the text after the research's hand-made edit), `naiveGate` (how Mermaid and the research's comparison judged that text: `PASS`, `FAIL-parse`, `FAIL-render` or `FAIL-semantic`), `note`.
- Where `naiveGate` is not `PASS` and the editor plans the operation, the test asserts that the naive text really differs from the promised meaning in Mermaid 12.1.0 (one documented exception: `SQE-M08`, see the test).

## gantt-corpus.json

Input of the differential test of the gantt reader (`src/features/mermaid/gantt-reader.real.dom.test.ts`). 417 cases: the 281 syntax inputs of the gantt research (`GT-<group>-<n>`), and for each of its 68 hand-made edit scenarios the text before the edit (`GTE-...:before`, group `scenarioBefore`) and after the research's naive edit (`GTE-...:naive`, group `scenarioNaive`; none of the edits failed to apply).

- Origin: the project's gantt research corpus (not included in the repository). Generated once by a throw-away script (not in the repository).
- Project-authored research input: no third-party code or corpus is included.
- Fields: `id`, `group` (`scenarioBefore`, `scenarioNaive`, or the syntax group such as `hdr`, `cm`, `df`, `tk`, `ck`), `source`, `note` (the research's description in words, informal).
- The expected results are not stored: Mermaid 12.1.0 is the reference and decides at test time. The test asserts recorded counts per input set, so a change in Mermaid or in the reader shows up as a failure.
