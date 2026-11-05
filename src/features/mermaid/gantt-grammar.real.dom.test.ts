// @vitest-environment jsdom
// Evidence for the gantt reader: how mermaid 12.3.0 reads gantt charts, and which
// of those inputs the domain (src/domain/diagram/gantt/) calls editable. Each case names a
// fact; the test name states the evidence. "mermaid" means that Mermaid
// accepts the text AND the app's render check draws it (jsdom cannot lay text out, so
// "draws" means the real renderer and the SVG sanitiser accept it). An accepted input that is
// not editable is "recognised, not editable", stated on purpose.
import { beforeAll, describe, expect, it } from "vitest";
import { ganttEditability } from "../../domain/diagram/gantt/gantt-editability";
import { parseGantt } from "../../domain/diagram/gantt/gantt-parser";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import {
  isolateMermaidGanttState,
  readGanttWithMermaid,
} from "./test-support/mermaid-gantt-db";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

interface GrammarCase {
  readonly name: string;
  readonly source: string;
  // Does mermaid 12.3.0 accept the text and does the app draw it?
  readonly mermaid: boolean;
  readonly editable: boolean;
}

const HEAD = "gantt\n  dateFormat YYYY-MM-DD\n";
const FIRST = "  A :a1, 2024-01-01, 2d\n";
const chart = (...lines: readonly string[]) =>
  `${HEAD}  section S\n${lines.map((line) => `  ${line}\n`).join("")}`;
const withFirst = (...lines: readonly string[]) =>
  chart("A :a1, 2024-01-01, 2d", ...lines);

const CASES: readonly GrammarCase[] = [
  // header and file level
  {
    name: "a minimal chart",
    source: withFirst("B :b1, after a1, 3d"),
    mermaid: true,
    editable: true,
  },
  {
    name: "header: Gantt is not the keyword",
    source: "Gantt\n  dateFormat YYYY-MM-DD\n",
    mermaid: false,
    editable: false,
  },
  {
    name: "header: gantt; fails",
    source: "gantt;\n  dateFormat YYYY-MM-DD\n",
    mermaid: false,
    editable: false,
  },
  {
    name: "header: a statement on the header line",
    source: "gantt dateFormat YYYY-MM-DD\n  A :a1, 2024-01-01, 2d\n",
    mermaid: true,
    editable: false,
  },
  {
    name: "no dateFormat: dates are read, but not by a format the editor can check",
    source: "gantt\n  section S\n  A :a1, 2024-01-01, 2d\n",
    mermaid: true,
    editable: false,
  },
  {
    name: "dateFormat appears twice",
    source: `${HEAD}  dateFormat YYYY-MM-DD\n  section S\n${FIRST}`,
    mermaid: true,
    editable: false,
  },
  {
    name: "dateFormat after the tasks still applies",
    source: `gantt\n  section S\n${FIRST}  dateFormat YYYY-MM-DD\n`,
    mermaid: true,
    editable: true,
  },
  {
    name: "front matter and an init directive",
    source: `---\ntitle: FM\n---\n%%{init: {"theme":"forest"}}%%\n${withFirst()}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "CRLF line breaks",
    source: withFirst("B :b1, after a1, 1d").replace(/\n/g, "\r\n"),
    mermaid: true,
    editable: true,
  },
  {
    name: "tab indentation",
    source: `gantt\n\tdateFormat YYYY-MM-DD\n\tsection S\n\tA :a1, 2024-01-01, 2d\n`,
    mermaid: true,
    editable: true,
  },
  {
    name: "a lone CR is not a line break for the app",
    source: "gantt\r  dateFormat YYYY-MM-DD\r  A :a1, 2024-01-01, 2d\r",
    mermaid: true,
    editable: false,
  },
  // comments
  {
    name: "comment: %% line and % line",
    source: withFirst("%% note", "% note"),
    mermaid: true,
    editable: true,
  },
  {
    name: "comment: a # line is a parse error",
    source: withFirst("# note"),
    mermaid: false,
    editable: false,
  },
  {
    name: "comment: # after task data is a parse error",
    source: withFirst("B :b1, after a1, 1d # c"),
    mermaid: false,
    editable: false,
  },
  {
    name: "comment: ; after task data is a parse error",
    source: withFirst("B :b1, after a1, 1d; x"),
    mermaid: false,
    editable: false,
  },
  {
    name: "comment: %% after task data becomes part of the end text",
    source: withFirst("B :b1, after a1, 1d %% c"),
    mermaid: true,
    editable: false,
  },
  {
    name: "comment: %% after dateFormat becomes part of the format",
    source:
      "gantt\n  dateFormat YYYY-MM-DD %% c\n  section S\n  A :a1, 2024-01-01, 2d\n",
    mermaid: true,
    editable: false,
  },
  {
    name: "comment: a word starting with % hides the line",
    source: withFirst("5% rule :b1, after a1, 1d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "comment: a % later in a word is plain text",
    source: withFirst("50% done :b1, after a1, 1d"),
    mermaid: true,
    editable: true,
  },
  // settings
  {
    name: "settings: axisFormat, tickInterval, todayMarker, weekday, weekend, includes, excludes",
    source: `${HEAD}  axisFormat %m/%d\n  tickInterval 1week\n  todayMarker off\n  weekday monday\n  weekend friday\n  includes 2024-01-06\n  excludes weekends\n  section S\n${FIRST}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "settings: excludes covering all 7 days",
    source: `${HEAD}  excludes monday tuesday wednesday thursday friday saturday sunday\n  section S\n${FIRST}`,
    mermaid: false,
    editable: false,
  },
  {
    name: "settings: topAxis throws in 12.3.0",
    source: `${HEAD}  topAxis\n  section S\n${FIRST}`,
    mermaid: false,
    editable: false,
  },
  {
    name: "settings: inclusiveEndDates",
    source: `${HEAD}  inclusiveEndDates\n  section S\n${FIRST}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "settings: accTitle is not understood",
    source: `${HEAD}  accTitle: T\n  section S\n${FIRST}`,
    mermaid: true,
    editable: false,
  },
  {
    name: "settings: a bare title swallows the next line",
    source: `${HEAD}  title\n  section S\n${FIRST}`,
    mermaid: true,
    editable: false,
  },
  {
    name: "settings: a bare dateFormat takes the next line as its value",
    source: `gantt\n  dateFormat\n  section S\n${FIRST}`,
    mermaid: true,
    editable: false,
  },
  {
    name: "title and section",
    source: `${HEAD}  title Release plan\n  section Design\n${FIRST}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: a semicolon ends the statement (the text after it is lost or misread)",
    source: `${HEAD}  title A;B\n  section S\n${FIRST}`,
    mermaid: true,
    editable: false,
  },
  {
    name: "section: duplicate names are drawn as one",
    source: `${HEAD}  section A\n${FIRST}  section A\n  B :b1, 2024-01-05, 2d\n`,
    mermaid: true,
    editable: false,
  },
  {
    name: "section: trailing blanks are part of the name",
    source: `${HEAD}  section A  \n${FIRST}`,
    mermaid: true,
    editable: false,
  },
  // date formats
  {
    name: "dateFormat DD/MM/YYYY",
    source:
      "gantt\n  dateFormat DD/MM/YYYY\n  section S\n  A :a1, 31/01/2024, 2d\n",
    mermaid: true,
    editable: true,
  },
  {
    name: "dateFormat MM/DD/YYYY",
    source:
      "gantt\n  dateFormat MM/DD/YYYY\n  section S\n  A :a1, 01/31/2024, 2d\n",
    mermaid: true,
    editable: true,
  },
  {
    name: "dateFormat YYYY/MM/DD",
    source:
      "gantt\n  dateFormat YYYY/MM/DD\n  section S\n  A :a1, 2024/01/31, 2d\n",
    mermaid: true,
    editable: true,
  },
  {
    name: "dateFormat YYYY-MM-DD HH:mm",
    source:
      "gantt\n  dateFormat YYYY-MM-DD HH:mm\n  section S\n  A :a1, 2024-01-31 09:30, 2h\n",
    mermaid: true,
    editable: true,
  },
  {
    name: "dateFormat HH:mm resolves to today: not editable",
    source: "gantt\n  dateFormat HH:mm\n  section S\n  A :a1, 09:30, 2h\n",
    mermaid: true,
    editable: false,
  },
  {
    name: "dateFormat DD.MM.YYYY is valid but not supported",
    source:
      "gantt\n  dateFormat DD.MM.YYYY\n  section S\n  A :a1, 31.01.2024, 2d\n",
    mermaid: true,
    editable: false,
  },
  // dates and lengths
  {
    name: "date: an impossible day is rescued by JavaScript Date",
    source: chart("A :a1, 2024-02-30, 2d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "date: a short month is rescued by JavaScript Date",
    source: chart("A :a1, 2024-1-5, 2d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "date: month 13 passes the parser and fails when drawn",
    source: chart("A :a1, 2024-13-01, 2d"),
    mermaid: false,
    editable: false,
  },
  {
    name: "date: a leap day is a real date",
    source: chart("A :a1, 2024-02-29, 2d"),
    mermaid: true,
    editable: true,
  },
  {
    name: "end: a date",
    source: chart("A :a1, 2024-01-01, 2024-01-05"),
    mermaid: true,
    editable: true,
  },
  {
    name: "end: until another task",
    source: withFirst("B :b1, 2024-01-02, until a1"),
    mermaid: true,
    editable: true,
  },
  {
    name: "duration: `5 days` is silently zero length",
    source: chart("A :a1, 2024-01-01, 5 days"),
    mermaid: true,
    editable: false,
  },
  {
    name: "duration: `10D` is silently zero length",
    source: chart("A :a1, 2024-01-01, 10D"),
    mermaid: true,
    editable: false,
  },
  {
    name: "duration: every unit of the pattern",
    source: chart(
      "A :a1, 2024-01-01, 1d",
      "B :b1, 2024-01-01, 1w",
      "C :c1, 2024-01-01, 2h",
      "D :d1, 2024-01-01, 30m",
      "E :e1, 2024-01-01, 1M",
      "F :f1, 2024-01-01, 1y",
      "G :g1, 2024-01-01, 5s",
      "H :h1, 2024-01-01, 5ms",
    ),
    mermaid: true,
    editable: true,
  },
  // task data
  {
    name: "task: tags come first",
    source: chart(
      "A :done, active, crit, a1, 2024-01-01, 2d",
      "B :milestone, vert, b1, after a1, 0d",
    ),
    mermaid: true,
    editable: true,
  },
  {
    name: "task: id, start and end",
    source: chart("A :a1, 2024-01-01, 2d"),
    mermaid: true,
    editable: true,
  },
  {
    name: "task: start and end without an id",
    source: chart("A :2024-01-01, 2d"),
    mermaid: true,
    editable: true,
  },
  {
    name: "task: an implicit start follows the previous task",
    source: withFirst("B :3d"),
    mermaid: true,
    editable: true,
  },
  {
    name: "task: the first task cannot have an implicit start",
    source: chart("A :3d"),
    mermaid: false,
    editable: false,
  },
  {
    name: "task: four data fields fail when drawn",
    source: chart("A :a1, 2024-01-01, 2d, 3d"),
    mermaid: false,
    editable: false,
  },
  {
    name: "task: tags only fail when drawn",
    source: chart("A :done"),
    mermaid: false,
    editable: false,
  },
  {
    name: "task: a tag after the id is a fourth field",
    source: chart("A :a1, 2024-01-01, 2d, done"),
    mermaid: false,
    editable: false,
  },
  {
    name: "task: an upper-case tag is an id",
    source: chart("A :Done, 2024-01-01, 2d"),
    mermaid: true,
    editable: true,
  },
  {
    name: "task: the same tag twice",
    source: chart("A :done, done, a1, 2024-01-01, 2d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "task: a name with a colon splits at the colon",
    source: chart("A: b :a1, 2024-01-01, 2d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "task: forward reference",
    source: chart("A :a1, after b1, 2d", "B :b1, 2024-01-01, 2d"),
    mermaid: true,
    editable: true,
  },
  {
    name: "task: after several ids",
    source: withFirst("B :b1, 2024-01-02, 2d", "C :c1, after a1 b1, 1d"),
    mermaid: true,
    editable: true,
  },
  {
    name: "task: dangling after resolves to today",
    source: withFirst("B :b1, after zz, 2d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "task: self reference",
    source: chart("A :a1, after a1, 2d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "task: cyclic reference",
    source: chart("A :a1, after b1, 2d", "B :b1, after a1, 2d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "task: duplicate ids re-point every reference",
    source: withFirst("B :a1, 2024-01-05, 2d", "C :after a1, 1d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "task: an explicit task1 collides with the generated id",
    source: chart(
      "A :2024-01-01, 2d",
      "B :task1, 2024-01-05, 2d",
      "C :after task1, 1d",
    ),
    mermaid: true,
    editable: false,
  },
  {
    name: "task: a reference to a generated id",
    source: chart("A :2024-01-01, 2d", "B :after task1, 2d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "task: an id outside [A-Za-z0-9_-]",
    source: chart("A :a.1, 2024-01-01, 2d"),
    mermaid: true,
    editable: false,
  },
  {
    name: "task: a name that starts with a keyword becomes that statement",
    source: `${HEAD}  section S\n  section x :a1, 2024-01-01, 2d\n`,
    mermaid: true,
    editable: true,
  },
  {
    name: "task: a name that starts with a date is a parse error",
    source: chart("2024-01-01 plan :a1, 2024-01-01, 2d"),
    mermaid: false,
    editable: false,
  },
  // click
  {
    name: "click: href after the task",
    source: withFirst('click a1 href "https://example.com/x"'),
    mermaid: true,
    editable: true,
  },
  {
    name: "click: before the task is ignored",
    source: `${HEAD}  section S\n  click a1 href "https://example.com/x"\n${FIRST}`,
    mermaid: true,
    editable: false,
  },
  {
    name: "click: several ids",
    source: withFirst(
      "B :b1, 2024-01-05, 2d",
      'click a1,b1 href "https://example.com/x"',
    ),
    mermaid: true,
    editable: true,
  },
  {
    name: "click: an unquoted href is a parse error",
    source: withFirst("click a1 href https://example.com"),
    mermaid: false,
    editable: false,
  },
  {
    name: "click: a javascript: url is rewritten by Mermaid",
    source: withFirst('click a1 href "javascript:alert(1)"'),
    mermaid: true,
    editable: false,
  },
  {
    name: "click: call is not understood",
    source: withFirst("click a1 call cb()"),
    mermaid: true,
    editable: false,
  },
];

async function mermaidDraws(source: string): Promise<boolean> {
  const reading = await readGanttWithMermaid(source);
  if (!reading.accepted || reading.db.tasks === null) return false;
  await isolateMermaidGanttState();
  return (await renderCheck(source)).ok;
}

describe("gantt grammar against mermaid 12.3.0", () => {
  for (const entry of CASES) {
    it(entry.name, async () => {
      expect(await mermaidDraws(entry.source), "mermaid draws it").toBe(
        entry.mermaid,
      );
      expect(
        ganttEditability(parseGantt(entry.source)).editable,
        "editable",
      ).toBe(entry.editable);
    });
  }
});
