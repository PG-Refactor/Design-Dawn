import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import { checkPieMeaning, pieMeaningOf } from "./pie-meaning";
import {
  type PieOperation,
  planPieOperation,
  verifyPieCandidate,
} from "./pie-operations";
import { parsePie } from "./pie-parser";

const BASE = 'pie\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15\n';

// Runs an operation the way the application does and proves the result: the edits apply,
// and the candidate reads as exactly the meaning the operation promised.
function run(source: string, operation: PieOperation): string {
  const plan = planPieOperation(source, operation);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(`edits: ${applied.error.detail}`);
  expect(verifyPieCandidate(applied.value.text, plan.value.expected)).toEqual({
    ok: true,
    value: undefined,
  });
  expect(applied.value.changed).toBe(plan.value.edits.length > 0);
  return applied.value.text;
}

function refusal(source: string, operation: PieOperation) {
  const plan = planPieOperation(source, operation);
  if (plan.ok) throw new Error("expected a refusal");
  return plan.error;
}

const dogs = { index: 0, label: "Dogs" };
const cats = { index: 1, label: "Cats" };

describe("addSlice", () => {
  it("appends by default, copying the indentation", () => {
    expect(run(BASE, { kind: "addSlice", label: "Cows", valueText: "7" })).toBe(
      `${BASE}  "Cows" : 7\n`,
    );
    expect(
      run('pie\n\t"A" : 1\n', { kind: "addSlice", label: "B", valueText: "2" }),
    ).toBe('pie\n\t"A" : 1\n\t"B" : 2\n');
  });

  it("inserts at the start and in the middle", () => {
    expect(
      run(BASE, { kind: "addSlice", label: "Cows", valueText: "7", index: 0 }),
    ).toBe('pie\n  "Cows" : 7\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15\n');
    expect(
      run(BASE, { kind: "addSlice", label: "Cows", valueText: "7", index: 2 }),
    ).toBe('pie\n  "Dogs" : 386\n  "Cats" : 85\n  "Cows" : 7\n  "Rats" : 15\n');
  });

  it("adds to an empty chart, after comments and a title, with the default indent", () => {
    expect(run("pie\n", { kind: "addSlice", label: "A", valueText: "1" })).toBe(
      'pie\n  "A" : 1\n',
    );
    expect(
      run("pie title T\n  %% c\n", {
        kind: "addSlice",
        label: "A",
        valueText: "1",
      }),
    ).toBe('pie title T\n  %% c\n  "A" : 1\n');
    // Never inside a multi-line accDescr block.
    expect(
      run("pie accDescr {\n  x\n  }", {
        kind: "addSlice",
        label: "A",
        valueText: "1",
      }),
    ).toBe('pie accDescr {\n  x\n  }\n  "A" : 1');
  });

  it("keeps CRLF next to CRLF and LF next to LF", () => {
    expect(
      run('pie\r\n  "A" : 1\r\n', {
        kind: "addSlice",
        label: "B",
        valueText: "2",
      }),
    ).toBe('pie\r\n  "A" : 1\r\n  "B" : 2\r\n');
    expect(
      run('pie\r\n  "A" : 1\r\n  "B" : 2\r\n', {
        kind: "addSlice",
        label: "C",
        valueText: "3",
        index: 1,
      }),
    ).toBe('pie\r\n  "A" : 1\r\n  "C" : 3\r\n  "B" : 2\r\n');
    expect(
      run('pie\n  "A" : 1\n', { kind: "addSlice", label: "B", valueText: "2" }),
    ).toBe('pie\n  "A" : 1\n  "B" : 2\n');
    // Mixed: the line it is inserted before decides.
    expect(
      run('pie\r\n "A":1\n', {
        kind: "addSlice",
        label: "B",
        valueText: "2",
        index: 0,
      }),
    ).toBe('pie\r\n "B" : 2\n "A":1\n');
  });

  it("handles a last line without a newline: no newline is added at the end", () => {
    expect(
      run('pie\n  "A" : 1', { kind: "addSlice", label: "B", valueText: "2" }),
    ).toBe('pie\n  "A" : 1\n  "B" : 2');
    expect(run("pie", { kind: "addSlice", label: "A", valueText: "1" })).toBe(
      'pie\n  "A" : 1',
    );
    expect(
      run('pie\r\n  "A" : 1', { kind: "addSlice", label: "B", valueText: "2" }),
    ).toBe('pie\r\n  "A" : 1\r\n  "B" : 2');
    expect(
      run('pie\n  "A" : 1', {
        kind: "addSlice",
        label: "B",
        valueText: "2",
        index: 0,
      }),
    ).toBe('pie\n  "B" : 2\n  "A" : 1');
  });

  it("encodes a double quote as #quot; and keeps the user's number text", () => {
    expect(
      run('pie\n  "A" : 1\n', {
        kind: "addSlice",
        label: 'say "hi"',
        valueText: "2.50",
      }),
    ).toBe('pie\n  "A" : 1\n  "say #quot;hi#quot;" : 2.50\n');
  });

  it.each([
    ["a line break", "a\nb", "controlCharacter"],
    ["a carriage return", "a\rb", "controlCharacter"],
    ["a tab", "a\tb", "controlCharacter"],
    ["a backslash", "a\\b", "backslash"],
    ["a directive", "a %%{init: {}}%% b", "directive"],
    ["an entity", "a #35; b", "entityLikeText"],
    ["style-like text", "style x:#a; y", "entityLikeText"],
  ])("refuses a label with %s", (_name, label, reason) => {
    const error = refusal(BASE, { kind: "addSlice", label, valueText: "1" });
    expect(error.kind).toBe("invalidDiagramOperation");
    expect(error.detail.startsWith(`${reason}:`)).toBe(true);
  });

  it("accepts the labels Mermaid reads back unchanged", () => {
    for (const label of [
      "",
      " lead and trail ",
      "a%%b",
      "犬🐶",
      "<b>x</b>",
      'a <a href="q"> b',
      "a];b",
      "a : b",
      "a#b",
    ]) {
      run(BASE, { kind: "addSlice", label, valueText: "1" });
    }
  });

  it.each([
    ["negative", "-1", "negativeValue"],
    ["signed", "+1", "invalidValue"],
    ["exponent", "1e3", "invalidValue"],
    ["leading dot", ".5", "invalidValue"],
    ["trailing dot", "1.", "invalidValue"],
    ["leading zero", "01", "invalidValue"],
    ["empty", "", "invalidValue"],
    ["text", "NaN", "invalidValue"],
    ["blank inside", "1 2", "invalidValue"],
    ["too large", "9".repeat(400), "valueOutOfRange"],
  ])("refuses a %s value", (_name, valueText, reason) => {
    const error = refusal(BASE, { kind: "addSlice", label: "X", valueText });
    expect(error.detail.startsWith(`${reason}:`)).toBe(true);
  });

  it("refuses a repeated label and a bad position", () => {
    expect(
      refusal(BASE, { kind: "addSlice", label: "Cats", valueText: "1" }).detail,
    ).toMatch(/^duplicateLabel:/);
    // Written forms are compared, so a different spelling is a different slice.
    run(BASE, { kind: "addSlice", label: "cats", valueText: "1" });
    run(BASE, { kind: "addSlice", label: "Cats ", valueText: "1" });
    for (const index of [-1, 4, 1.5]) {
      expect(
        refusal(BASE, { kind: "addSlice", label: "X", valueText: "1", index })
          .detail,
      ).toMatch(/^invalidIndex:/);
    }
  });
});

describe("renameSlice", () => {
  it("replaces only the label content", () => {
    expect(
      run(BASE, { kind: "renameSlice", target: cats, label: "Kittens" }),
    ).toBe('pie\n  "Dogs" : 386\n  "Kittens" : 85\n  "Rats" : 15\n');
    expect(
      run('pie\n  "A" :   1   %% keep\n', {
        kind: "renameSlice",
        target: { index: 0, label: "A" },
        label: 'B"',
      }),
    ).toBe('pie\n  "B#quot;" :   1   %% keep\n');
  });

  it("is a no-op for the same label", () => {
    const plan = planPieOperation(BASE, {
      kind: "renameSlice",
      target: cats,
      label: "Cats",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
  });

  it("refuses a name another slice has, a wrong target, and a single-quoted label", () => {
    expect(
      refusal(BASE, { kind: "renameSlice", target: cats, label: "Dogs" })
        .detail,
    ).toMatch(/^duplicateLabel:/);
    expect(
      refusal(BASE, {
        kind: "renameSlice",
        target: { index: 1, label: "Dogs" },
        label: "X",
      }).detail,
    ).toMatch(/^targetMismatch:/);
    expect(
      refusal(BASE, {
        kind: "renameSlice",
        target: { index: 9, label: "Dogs" },
        label: "X",
      }).detail,
    ).toMatch(/^targetNotFound:/);
    expect(
      refusal("pie\n  'A' : 1\n", {
        kind: "renameSlice",
        target: { index: 0, label: "A" },
        label: "B",
      }).detail,
    ).toMatch(/^singleQuotedLabel:/);
    expect(
      refusal(BASE, { kind: "renameSlice", target: cats, label: "a\nb" })
        .detail,
    ).toMatch(/^controlCharacter:/);
  });
});

describe("setSliceValue", () => {
  it("replaces only the value text and keeps the user's spelling", () => {
    expect(
      run(BASE, { kind: "setSliceValue", target: cats, valueText: "90.50" }),
    ).toBe('pie\n  "Dogs" : 386\n  "Cats" : 90.50\n  "Rats" : 15\n');
    expect(
      run('pie\n  "A" :\t1 %% c\n', {
        kind: "setSliceValue",
        target: { index: 0, label: "A" },
        valueText: "0",
      }),
    ).toBe('pie\n  "A" :\t0 %% c\n');
  });

  it("refuses an invalid value or target and treats the same text as a no-op", () => {
    expect(
      refusal(BASE, { kind: "setSliceValue", target: cats, valueText: "-5" })
        .detail,
    ).toMatch(/^negativeValue:/);
    expect(
      refusal(BASE, {
        kind: "setSliceValue",
        target: { index: 1, label: "x" },
        valueText: "5",
      }).detail,
    ).toMatch(/^targetMismatch:/);
    const plan = planPieOperation(BASE, {
      kind: "setSliceValue",
      target: cats,
      valueText: "85",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
  });
});

describe("deleteSlice", () => {
  it("removes the whole line with its terminator", () => {
    expect(run(BASE, { kind: "deleteSlice", target: cats })).toBe(
      'pie\n  "Dogs" : 386\n  "Rats" : 15\n',
    );
    expect(run(BASE, { kind: "deleteSlice", target: dogs })).toBe(
      'pie\n  "Cats" : 85\n  "Rats" : 15\n',
    );
    expect(
      run('pie\r\n  "A" : 1\r\n  "B" : 2\r\n', {
        kind: "deleteSlice",
        target: { index: 0, label: "A" },
      }),
    ).toBe('pie\r\n  "B" : 2\r\n');
  });

  it("deletes a last line without a newline cleanly (no dangling terminator, no overlap)", () => {
    expect(
      run('pie\n  "A" : 1\n  "B" : 2', {
        kind: "deleteSlice",
        target: { index: 1, label: "B" },
      }),
    ).toBe('pie\n  "A" : 1');
    expect(
      run('pie\r\n  "A" : 1\r\n  "B" : 2', {
        kind: "deleteSlice",
        target: { index: 1, label: "B" },
      }),
    ).toBe('pie\r\n  "A" : 1');
    expect(
      run('pie\n  "A" : 1', {
        kind: "deleteSlice",
        target: { index: 0, label: "A" },
      }),
    ).toBe("pie");
  });

  it("leaves comments and neighbours alone and can empty the chart", () => {
    expect(
      run('pie\n  %% a\n  "A" : 1\n  %% b\n', {
        kind: "deleteSlice",
        target: { index: 0, label: "A" },
      }),
    ).toBe("pie\n  %% a\n  %% b\n");
  });
});

describe("moveSlice", () => {
  it("moves a slice down, up, to the start and to the end, carrying the whole line", () => {
    const source =
      'pie\n  "A" : 1\n  %% between\n  "B" : 2 %% note\n  "C" : 3\n';
    const a = { index: 0, label: "A" };
    const b = { index: 1, label: "B" };
    const c = { index: 2, label: "C" };
    expect(run(source, { kind: "moveSlice", target: a, toIndex: 1 })).toBe(
      'pie\n  %% between\n  "B" : 2 %% note\n  "A" : 1\n  "C" : 3\n',
    );
    expect(run(source, { kind: "moveSlice", target: a, toIndex: 2 })).toBe(
      'pie\n  %% between\n  "B" : 2 %% note\n  "C" : 3\n  "A" : 1\n',
    );
    expect(run(source, { kind: "moveSlice", target: c, toIndex: 0 })).toBe(
      'pie\n  "C" : 3\n  "A" : 1\n  %% between\n  "B" : 2 %% note\n',
    );
    expect(run(source, { kind: "moveSlice", target: b, toIndex: 0 })).toBe(
      'pie\n  "B" : 2 %% note\n  "A" : 1\n  %% between\n  "C" : 3\n',
    );
  });

  it("handles a last line without a newline in both directions", () => {
    const source = 'pie\n  "A" : 1\n  "B" : 2\n  "C" : 3';
    expect(
      run(source, {
        kind: "moveSlice",
        target: { index: 2, label: "C" },
        toIndex: 0,
      }),
    ).toBe('pie\n  "C" : 3\n  "A" : 1\n  "B" : 2');
    expect(
      run(source, {
        kind: "moveSlice",
        target: { index: 0, label: "A" },
        toIndex: 2,
      }),
    ).toBe('pie\n  "B" : 2\n  "C" : 3\n  "A" : 1');
    expect(
      run(source, {
        kind: "moveSlice",
        target: { index: 2, label: "C" },
        toIndex: 1,
      }),
    ).toBe('pie\n  "A" : 1\n  "C" : 3\n  "B" : 2');
    expect(
      run('pie\r\n  "A" : 1\r\n  "B" : 2', {
        kind: "moveSlice",
        target: { index: 1, label: "B" },
        toIndex: 0,
      }),
    ).toBe('pie\r\n  "B" : 2\r\n  "A" : 1');
  });

  it("is a no-op to the same position and refuses a bad position", () => {
    const plan = planPieOperation(BASE, {
      kind: "moveSlice",
      target: cats,
      toIndex: 1,
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
    for (const toIndex of [-1, 3, 0.5]) {
      expect(
        refusal(BASE, { kind: "moveSlice", target: cats, toIndex }).detail,
      ).toMatch(/^invalidIndex:/);
    }
    expect(
      refusal(BASE, {
        kind: "moveSlice",
        target: { index: 1, label: "Rats" },
        toIndex: 0,
      }).detail,
    ).toMatch(/^targetMismatch:/);
  });
});

describe("setTitle / removeTitle", () => {
  it("replaces the text of an existing title and keeps the rest of the line", () => {
    expect(
      run('pie\n  title Old %% c\n  "A" : 1\n', {
        kind: "setTitle",
        title: "New one",
      }),
    ).toBe('pie\n  title New one %% c\n  "A" : 1\n');
    expect(
      run('pie showData title Old\n  "A" : 1\n', {
        kind: "setTitle",
        title: "New",
      }),
    ).toBe('pie showData title New\n  "A" : 1\n');
    // A bare `title` gets its text.
    expect(
      run('pie\n  title\n  "A" : 1\n', { kind: "setTitle", title: "T" }),
    ).toBe('pie\n  title T\n  "A" : 1\n');
    expect(
      run('pie\n  title%% c\n  "A" : 1\n', { kind: "setTitle", title: "T" }),
    ).toBe('pie\n  title T%% c\n  "A" : 1\n');
  });

  it("inserts a title line before the first slice, or at the end when there is none", () => {
    expect(run(BASE, { kind: "setTitle", title: "Pets" })).toBe(
      'pie\n  title Pets\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15\n',
    );
    expect(run("pie\n", { kind: "setTitle", title: "Pets" })).toBe(
      "pie\n  title Pets\n",
    );
    expect(run('pie\r\n  "A" : 1', { kind: "setTitle", title: "T" })).toBe(
      'pie\r\n  title T\r\n  "A" : 1',
    );
  });

  it("removes a title line, or the title part of the header", () => {
    expect(run('pie\n  title T\n  "A" : 1\n', { kind: "removeTitle" })).toBe(
      'pie\n  "A" : 1\n',
    );
    expect(run('pie\n  "A" : 1\n  title T', { kind: "removeTitle" })).toBe(
      'pie\n  "A" : 1',
    );
    expect(run('pie title T\n  "A" : 1\n', { kind: "removeTitle" })).toBe(
      'pie\n  "A" : 1\n',
    );
    expect(
      run('pie showData title T %% c\n  "A" : 1\n', { kind: "removeTitle" }),
    ).toBe('pie showData %% c\n  "A" : 1\n');
    expect(run('pie title\n  "A" : 1\n', { kind: "removeTitle" })).toBe(
      'pie\n  "A" : 1\n',
    );
  });

  it("refuses what it cannot do safely", () => {
    expect(refusal(BASE, { kind: "removeTitle" }).detail).toMatch(/^noTitle:/);
    const twice = 'pie\n  title A\n  title B\n  "A" : 1\n';
    expect(refusal(twice, { kind: "setTitle", title: "X" }).detail).toMatch(
      /^multipleTitles:/,
    );
    expect(refusal(twice, { kind: "removeTitle" }).detail).toMatch(
      /^multipleTitles:/,
    );
    for (const [title, reason] of [
      ["", "emptyTitle"],
      ["a\nb", "controlCharacter"],
      [" lead", "titleNotNormalized"],
      ["two  blanks", "titleNotNormalized"],
      ["a %% b", "comment"],
      ["a #35; b", "entityLikeText"],
      ['<a href="q">', "markup"],
    ] as const) {
      expect(
        refusal(BASE, { kind: "setTitle", title }).detail.startsWith(
          `${reason}:`,
        ),
      ).toBe(true);
    }
  });
});

describe("refusals on charts that are not editable", () => {
  it.each([
    ["an unsupported line", 'pie\n  oops\n  "A" : 1\n'],
    ["a repeated label", 'pie\n  "A" : 1\n  "A" : 2\n'],
    ["another diagram type", "graph TD\nA-->B\n"],
    ["a malformed slice", 'pie\n  "A" : -1\n'],
  ])("refuses every operation on %s", (_name, source) => {
    const operations: PieOperation[] = [
      { kind: "addSlice", label: "X", valueText: "1" },
      { kind: "renameSlice", target: { index: 0, label: "A" }, label: "B" },
      {
        kind: "setSliceValue",
        target: { index: 0, label: "A" },
        valueText: "2",
      },
      { kind: "deleteSlice", target: { index: 0, label: "A" } },
      { kind: "moveSlice", target: { index: 0, label: "A" }, toIndex: 0 },
      { kind: "setTitle", title: "T" },
      { kind: "removeTitle" },
    ];
    for (const operation of operations) {
      expect(refusal(source, operation).kind).toBe("diagramNotEditable");
    }
  });
});

describe("checkPieMeaning", () => {
  const before = pieMeaningOf(parsePie(BASE));
  const verdict = (candidate: string, expected = before) =>
    checkPieMeaning(parsePie(candidate), expected);

  it("passes a correct add, delete, change and reorder", () => {
    for (const [candidate, expected] of [
      [
        `${BASE}  "Cows" : 7\n`,
        { ...before, slices: [...before.slices, { label: "Cows", value: 7 }] },
      ],
      [
        'pie\n  "Dogs" : 386\n  "Rats" : 15\n',
        { ...before, slices: [before.slices[0], before.slices[2]] },
      ],
      [
        'pie\n  "Dogs" : 386\n  "Cats" : 1\n  "Rats" : 15\n',
        {
          ...before,
          slices: [
            before.slices[0],
            { label: "Cats", value: 1 },
            before.slices[2],
          ],
        },
      ],
      [
        'pie\n  "Rats" : 15\n  "Dogs" : 386\n  "Cats" : 85\n',
        {
          ...before,
          slices: [before.slices[2], before.slices[0], before.slices[1]],
        },
      ],
    ] as const) {
      expect(verdict(candidate, expected as typeof before).ok).toBe(true);
    }
  });

  it("rejects a candidate that also changes something else", () => {
    // Promised: only Cats' value changes. Delivered: Rats changed too.
    const promised = {
      ...before,
      slices: [before.slices[0], { label: "Cats", value: 1 }, before.slices[2]],
    };
    const crafted = 'pie\n  "Dogs" : 386\n  "Cats" : 1\n  "Rats" : 99\n';
    const result = verdict(crafted, promised as typeof before);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("diagramMeaningMismatch");
    expect(!result.ok && result.error.detail).toContain(
      "slice 2 value: expected 15, got 99",
    );

    for (const [candidate, fragment] of [
      ['pie\n  "Dogs" : 386\n  "Rats" : 15\n  "Cats" : 85\n', "slice 1 label"],
      ['pie\n  "Dogs" : 386\n  "Cats" : 85\n', "slice count"],
      [`pie title X\n${BASE.slice(4)}`, "title"],
      [`pie showData\n${BASE.slice(4)}`, "showData"],
      [
        'pie\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15\n  "Cows" : 1\n',
        "slice count",
      ],
    ] as const) {
      const rejected = verdict(candidate);
      expect(rejected.ok, candidate).toBe(false);
      expect(!rejected.ok && rejected.error.detail).toContain(fragment);
    }
  });

  it("rejects an unreadable or unparsable candidate", () => {
    for (const candidate of [
      "",
      "graph TD\n",
      'pie\n  "Dogs" : 386\n  oops\n',
      'pie\n  "Dogs" : 1\n  "Dogs" : 2\n',
    ]) {
      const result = verdict(candidate);
      expect(result.ok, candidate).toBe(false);
      expect(!result.ok && result.error.kind).toBe("diagramNotEditable");
    }
  });

  it("catches a label write that Mermaid would read differently", () => {
    // A directive inside a label would be stripped by Mermaid; the candidate is rejected
    // as an inline directive even if an operation had let it through.
    const result = verdict(
      'pie\n  "Dogs" : 386\n  "Ca %%{init: {}}%% ts" : 85\n  "Rats" : 15\n',
    );
    expect(result.ok).toBe(false);
  });
});
