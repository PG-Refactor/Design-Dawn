import { describe, expect, it } from "vitest";
import { ganttEditability } from "./gantt-editability";
import { ganttMeaningOf, resolveGanttSchedule } from "./gantt-meaning";
import { parseGantt } from "./gantt-parser";

const HEAD = "gantt\n    dateFormat YYYY-MM-DD\n";

function parsed(body: string, head: string = HEAD) {
  return parseGantt(head + body);
}

function reasonOf(source: string): string | null {
  const verdict = ganttEditability(parseGantt(source));
  return verdict.editable ? null : verdict.reason;
}

function unsupportedReasons(source: string): readonly string[] {
  return parseGantt(source).unsupported.map((entry) => entry.reason);
}

describe("parseGantt: structure and spans", () => {
  const source = `${HEAD}    title Release plan\n    section Design\n    Spec :done, crit, des1, 2024-01-01, 3d\n    Review :after des1, 2d\n    Wrap up :3d\n    click des1 href "https://example.com/x"\n`;
  const result = parseGantt(source);

  it("finds the statements", () => {
    expect(result.isGantt).toBe(true);
    expect(result.dateFormat).toBe("YYYY-MM-DD");
    expect(result.titles.map((title) => title.text)).toEqual(["Release plan"]);
    expect(result.sections.map((section) => section.name)).toEqual(["Design"]);
    expect(result.tasks.map((task) => task.name)).toEqual([
      "Spec",
      "Review",
      "Wrap up",
    ]);
    expect(result.clicks).toHaveLength(1);
    expect(result.unsupported).toEqual([]);
  });

  it("gives spans that cut the written text out of the source", () => {
    const text = (span: { start: number; end: number }) =>
      source.slice(span.start, span.end);
    const [spec, review, wrap] = result.tasks;
    expect(text(spec?.nameSpan ?? { start: 0, end: 0 })).toBe("Spec");
    expect(text(spec?.idSpan ?? { start: 0, end: 0 })).toBe("des1");
    expect(text(spec?.startSpan ?? { start: 0, end: 0 })).toBe("2024-01-01");
    expect(text(spec?.endSpan ?? { start: 0, end: 0 })).toBe("3d");
    expect(text(spec?.tagsSpan ?? { start: 0, end: 0 })).toBe("done, crit, ");
    expect(spec?.tags).toEqual(["done", "crit"]);
    expect(text(review?.startSpan ?? { start: 0, end: 0 })).toBe("after des1");
    expect(
      review?.startReferences.map((reference) => text(reference.span)),
    ).toEqual(["des1"]);
    expect(review?.id).toBeNull();
    expect(wrap?.start).toEqual({ kind: "implicit" });
    expect(wrap?.startSpan).toBeNull();
    expect(text(wrap?.nameSpan ?? { start: 0, end: 0 })).toBe("Wrap up");
    expect(
      text({
        start: result.titles[0]?.textSpan.start ?? 0,
        end: result.titles[0]?.textSpan.end ?? 0,
      }),
    ).toBe("Release plan");
    expect(
      text(result.clicks[0]?.references[0]?.span ?? { start: 0, end: 0 }),
    ).toBe("des1");
  });

  it("assigns tasks to the section above them", () => {
    const withTwo = parsed(
      "    A :a1, 2024-01-01, 1d\n    section S1\n    B :b1, 2024-01-02, 1d\n    section S2\n    C :c1, 2024-01-03, 1d\n",
    );
    expect(withTwo.tasks.map((task) => task.sectionIndex)).toEqual([-1, 0, 1]);
    expect(ganttMeaningOf(withTwo)?.tasks.map((task) => task.section)).toEqual([
      "",
      "S1",
      "S2",
    ]);
  });

  it("keeps CRLF files readable and the offsets right", () => {
    const crlf = `${HEAD}    section S\n    A :a1, 2024-01-01, 2d\n`.replace(
      /\n/g,
      "\r\n",
    );
    const result = parseGantt(crlf);
    expect(ganttEditability(result).editable).toBe(true);
    const task = result.tasks[0];
    expect(crlf.slice(task?.nameSpan.start, task?.nameSpan.end)).toBe("A");
    expect(crlf.slice(task?.endSpan.start, task?.endSpan.end)).toBe("2d");
  });

  it("is not a gantt chart for other diagram types", () => {
    const other = parseGantt('pie\n  "a" : 1\n');
    expect(other.isGantt).toBe(false);
    expect(reasonOf('pie\n  "a" : 1\n')).toBe("notGantt");
    expect(reasonOf("")).toBe("notGantt");
  });
});

describe("ganttEditability", () => {
  it("accepts a plain chart and tolerates settings, comments and front matter", () => {
    const source = `---\ntitle: x\n---\n%%{init: {"theme":"forest"}}%%\n${HEAD}    axisFormat %m/%d\n    excludes weekends\n    %% a comment\n    % another\n    section S\n    A :a1, 2024-01-01, 2d\n`;
    expect(reasonOf(source)).toBeNull();
  });

  it("reports the dateFormat problems before the lines they cause", () => {
    expect(reasonOf("gantt\n    A :a1, 2024-01-01, 2d\n")).toBe(
      "dateFormatMissing",
    );
    expect(
      reasonOf(`${HEAD}    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 2d\n`),
    ).toBe("duplicateDateFormat");
    expect(
      reasonOf("gantt\n    dateFormat MM-DD-YYYY\n    A :a1, 01-31-2024, 2d\n"),
    ).toBe("unsupportedDateFormat");
    expect(
      reasonOf(
        "gantt\n    dateFormat YYYY-MM-DD %% c\n    A :a1, 2024-01-01, 2d\n",
      ),
    ).toBe("unsupportedDateFormat");
  });

  it("refuses every line it cannot account for, naming the reason", () => {
    const reasons: readonly (readonly [string, string])[] = [
      ["    A :a1, 2024-01-01, 2d # c\n", "specialCharacter"],
      ["    A :a1, 2024-01-01, 2d; x\n", "specialCharacter"],
      ["    A :a1, 2024-01-01, 2d %% c\n", "commentMark"],
      ["    5% rule :a1, 2024-01-01, 2d\n", "commentMark"],
      ["    A :a1, 2024-01-01, 2d, 3d\n", "tooManyFields"],
      ["    A :done\n", "noDataAfterTags"],
      ["    A :a1, , 2d\n", "emptyField"],
      ["    A :done, done, a1, 2024-01-01, 2d\n", "duplicateTag"],
      ["    A :a.1, 2024-01-01, 2d\n", "invalidId"],
      ["    A :task1, 2024-01-01, 2d\n", "autoIdShape"],
      [
        "    A :a1, 2024-01-01, 2d\n    B :after task1, 1d\n",
        "autoIdReference",
      ],
      ["    A :a1, 2024-02-30, 2d\n", "invalidStart"],
      ["    A :a1, 2024-01-01, 5 days\n", "invalidEnd"],
      ["    A :a1, 2024-01-01, after a1\n", "invalidEnd"],
      ["    title\n", "emptyDirectiveValue"],
      ["    section\n", "emptyDirectiveValue"],
      ["    section A  \n", "untrimmedText"],
      ["    title A;B\n", "specialCharacter"],
      ["    topAxis\n", "topAxis"],
      ["    accTitle: x\n", "accessibility"],
      ["    click a1 call cb()\n", "clickForm"],
      ['    click zz href "https://example.com/"\n', "clickReference"],
      [
        "    title page :a1, 2024-01-01, 2d\n    gantt x :a1, 2024-01-01, 2d\n",
        "keywordLedName",
      ],
      ["    just words\n", "notATask"],
      ["    :a1, 2024-01-01, 2d\n", "emptyTaskName"],
      ["    A :\n", "emptyTaskData"],
    ];
    for (const [body, reason] of reasons) {
      const source = `${HEAD}    A0 :a0, 2024-01-01, 1d\n${body}`;
      expect(unsupportedReasons(source), body).toContain(reason);
      expect(reasonOf(source), body).not.toBeNull();
    }
  });

  it("refuses text Mermaid rewrites or rejects as a whole", () => {
    const task = "    A :a1, 2024-01-01, 2d\n";
    expect(reasonOf(`gantt\r    dateFormat YYYY-MM-DD\r${task}`)).toBe(
      "loneCarriageReturn",
    );
    expect(
      reasonOf(`${HEAD}    <b class="x">A</b> :a1, 2024-01-01, 2d\n`),
    ).toBe("markupRewrite");
    expect(reasonOf(`${HEAD}    A %%{init: {}}%% :a1, 2024-01-01, 2d\n`)).toBe(
      "inlineDirective",
    );
    expect(reasonOf(`${HEAD}${task}${"    %% x\n".repeat(6000)}`)).toBe(
      "tooLong",
    );
    expect(reasonOf(`---\nnot yaml here\n---\n${HEAD}${task}`)).toBe(
      "unreadableFrontMatter",
    );
  });

  it("refuses structures whose meaning depends on Mermaid internals", () => {
    const dup = `${HEAD}    A :a1, 2024-01-01, 1d\n    B :a1, 2024-01-02, 1d\n`;
    expect(reasonOf(dup)).toBe("duplicateTaskIds");
    expect(
      reasonOf(
        `${HEAD}    section A\n    A :a1, 2024-01-01, 1d\n    section A\n    B :b1, 2024-01-02, 1d\n`,
      ),
    ).toBe("duplicateSectionNames");
    expect(
      reasonOf(`${HEAD}    A :a1, 2024-01-01, 1d\n    B :b1, after zz, 1d\n`),
    ).toBe("danglingReference");
    expect(reasonOf(`${HEAD}    A :a1, after a1, 1d\n`)).toBe(
      "cyclicReference",
    );
    expect(
      reasonOf(`${HEAD}    A :a1, after b1, 1d\n    B :b1, after a1, 1d\n`),
    ).toBe("cyclicReference");
    expect(
      reasonOf(
        `${HEAD}    excludes monday tuesday, wednesday thursday friday\n    excludes saturday sunday\n    A :a1, 2024-01-01, 1d\n`,
      ),
    ).toBe("allDaysExcluded");
    expect(
      reasonOf(
        `${HEAD}    excludes weekends\n    weekend friday\n    excludes sunday monday tuesday wednesday thursday\n    A :a1, 2024-01-01, 1d\n`,
      ),
    ).toBe("allDaysExcluded");
    expect(reasonOf(`${HEAD}    A :3d\n`)).toBe("firstTaskImplicitStart");
  });

  it("allows an id that is also a task name word and a forward reference", () => {
    expect(
      reasonOf(`${HEAD}    A :a1, after b1, 1d\n    B :b1, 2024-01-01, 1d\n`),
    ).toBeNull();
  });

  it("accepts a click only after the task it names", () => {
    expect(
      reasonOf(
        `${HEAD}    A :a1, 2024-01-01, 1d\n    click a1 href "https://example.com/"\n`,
      ),
    ).toBeNull();
    expect(
      reasonOf(
        `${HEAD}    click a1 href "https://example.com/"\n    A :a1, 2024-01-01, 1d\n`,
      ),
    ).toBe("unsupportedLines");
    expect(
      reasonOf(
        `${HEAD}    A :a1, 2024-01-01, 1d\n    click a1 href "javascript:alert(1)"\n`,
      ),
    ).toBe("unsupportedLines");
  });
});

describe("ganttMeaningOf", () => {
  it("holds the chart as Mermaid reads it", () => {
    const meaning = ganttMeaningOf(
      parsed(
        '    title Plan\n    section S\n    A :crit, done, a1, 2024-01-01, 2d\n    B :after a1, until a1\n    click a1 href "https://example.com/x"\n',
      ),
    );
    expect(meaning?.title).toBe("Plan");
    expect(meaning?.sections).toEqual(["S"]);
    expect(meaning?.tasks[0]).toEqual({
      section: "S",
      name: "A",
      id: "a1",
      tags: ["done", "crit"],
      start: { kind: "date", text: "2024-01-01" },
      end: { kind: "duration", text: "2d" },
    });
    expect(meaning?.tasks[1]?.start).toEqual({ kind: "after", ids: ["a1"] });
    expect(meaning?.tasks[1]?.end).toEqual({ kind: "until", ids: ["a1"] });
    expect(meaning?.links).toEqual([
      { id: "a1", url: "https://example.com/x" },
    ]);
    expect(meaning?.settings).toEqual([
      { keyword: "dateformat", value: "YYYY-MM-DD" },
    ]);
  });

  it("does not depend on the order tags were written in", () => {
    const left = ganttMeaningOf(
      parsed("    A :done, crit, a1, 2024-01-01, 1d\n"),
    );
    const right = ganttMeaningOf(
      parsed("    A :crit, done, a1, 2024-01-01, 1d\n"),
    );
    expect(left).toEqual(right);
  });

  it("has no meaning without a supported dateFormat", () => {
    expect(
      ganttMeaningOf(parseGantt("gantt\n  A :a1, 2024-01-01, 1d\n")),
    ).toBeNull();
  });
});

describe("resolveGanttSchedule", () => {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

  it("resolves dates, after, until, implicit starts and durations", () => {
    const meaning = ganttMeaningOf(
      parsed(
        "    A :a1, 2024-01-01, 3d\n    B :b1, after a1, 2d\n    C :2d\n    D :d1, 2024-01-02, until a1\n    E :e1, after a1 b1, 1w\n    F :f1, 2024-01-01, 2024-01-09\n",
      ),
    ) as NonNullable<ReturnType<typeof ganttMeaningOf>>;
    const schedule = resolveGanttSchedule(meaning);
    expect(schedule[0]).toEqual({
      start: day("2024-01-01"),
      end: day("2024-01-04"),
    });
    expect(schedule[1]).toEqual({
      start: day("2024-01-04"),
      end: day("2024-01-06"),
    });
    expect(schedule[2]).toEqual({
      start: day("2024-01-06"),
      end: day("2024-01-08"),
    });
    expect(schedule[3]).toEqual({
      start: day("2024-01-02"),
      end: day("2024-01-01"),
    });
    expect(schedule[4]).toEqual({
      start: day("2024-01-06"),
      end: day("2024-01-13"),
    });
    expect(schedule[5]).toEqual({
      start: day("2024-01-01"),
      end: day("2024-01-09"),
    });
  });

  it("returns null where the editor does not model the result", () => {
    const base =
      "    A :a1, 2024-01-01, 1M\n    B :b1, after a1, 1d\n    C :c1, 2024-01-01, 1d\n";
    const odd = ganttMeaningOf(parsed(base)) as NonNullable<
      ReturnType<typeof ganttMeaningOf>
    >;
    expect(resolveGanttSchedule(odd)).toEqual([
      null,
      null,
      { start: day("2024-01-01"), end: day("2024-01-02") },
    ]);
    const excluded = ganttMeaningOf(
      parsed(`    excludes weekends\n${base}`),
    ) as NonNullable<ReturnType<typeof ganttMeaningOf>>;
    expect(resolveGanttSchedule(excluded)).toEqual([null, null, null]);
    const inclusive = ganttMeaningOf(
      parsed(`    inclusiveEndDates\n${base}`),
    ) as NonNullable<ReturnType<typeof ganttMeaningOf>>;
    expect(resolveGanttSchedule(inclusive)).toEqual([null, null, null]);
  });
});
