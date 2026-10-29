// TEST ONLY. Reads what Mermaid 12.1.0 itself holds after reading a gantt chart, through its
// internal diagram API (`mermaid.mermaidAPI.getDiagramFromText(...).db`). That API is not
// public and may change with the library version; nothing in the app uses it. It is the
// independent reference the domain's GanttMeaning and static dates are compared against. If
// the shape of the db changes, this file throws "internal API changed" instead of comparing
// nothing.
//
// Isolation: Mermaid keeps the gantt `taskDb` (task id to position) at module level and never
// clears it. A reference to an unknown id (`after zz`) can therefore bind to a task of an
// EARLIER diagram, and a task with four data fields poisons `taskDb["undefined"]`, which
// changes the first task of a later chart. Before every measurement this file re-registers
// every id seen so far at a position no test chart reaches and overwrites that key. The app
// has no such isolation, which is why the editor refuses dangling references and a first
// task without a start (docs/architecture.md §16.17).
import mermaid from "mermaid";
import { buildMermaidConfig } from "../mermaid-config";
import { decodeMermaidMarkers } from "./mermaid-pie-db";

export interface DbTask {
  readonly id: string;
  readonly section: string;
  readonly name: string;
  readonly flags: readonly string[];
  readonly rawData: string;
  readonly startKind: string;
  readonly startData: string;
  readonly endData: string;
  // Face-value milliseconds of the local calendar fields, or null.
  readonly start: number | null;
  readonly end: number | null;
}

export interface DbGantt {
  readonly dateFormat: string;
  readonly axisFormat: string;
  readonly tickInterval: string;
  readonly todayMarker: string;
  readonly excludes: readonly string[];
  readonly includes: readonly string[];
  readonly weekday: string;
  readonly inclusive: boolean;
  readonly topAxis: boolean;
  readonly title: string;
  readonly sections: readonly string[];
  readonly links: readonly (readonly [string, string])[];
  // Null when Mermaid cannot compile the tasks (a parse-ok, render-error chart).
  readonly tasks: readonly DbTask[] | null;
  readonly tasksError: string | null;
}

export type MermaidGanttReading =
  | { readonly accepted: true; readonly db: DbGantt }
  | { readonly accepted: false; readonly message: string };

interface RawTaskDb {
  id: string;
  section: string;
  task: string;
  active?: boolean;
  done?: boolean;
  crit?: boolean;
  milestone?: boolean;
  vert?: boolean;
  startTime?: unknown;
  endTime?: unknown;
  raw?: {
    data?: string;
    startTime?: { type?: string; startData?: string };
    endTime?: { data?: string };
  };
}

interface MermaidGanttDb {
  getSections(): string[];
  getTasks(): RawTaskDb[];
  getDateFormat(): string;
  getAxisFormat(): string;
  getTickInterval(): string | undefined;
  getTodayMarker(): string;
  getExcludes(): string[];
  getIncludes(): string[];
  getWeekday(): string;
  endDatesAreInclusive(): boolean;
  topAxisEnabled(): boolean;
  getDiagramTitle(): string;
  getLinks(): Map<string, string>;
}

const REQUIRED_DB_FUNCTIONS = [
  "getSections",
  "getTasks",
  "getDateFormat",
  "getAxisFormat",
  "getTickInterval",
  "getTodayMarker",
  "getExcludes",
  "getIncludes",
  "getWeekday",
  "endDatesAreInclusive",
  "topAxisEnabled",
  "getDiagramTitle",
  "getLinks",
] as const;

const FLAG_NAMES = ["active", "done", "crit", "milestone", "vert"] as const;
const POISON_FILLER_COUNT = 400;
const MAX_MESSAGE_LENGTH = 300;
const ID_WORD_PATTERN = /[\p{L}\p{N}_.\-:]+/gu;
const TAG_PATTERN = /^\s*(active|done|crit|milestone|vert)\s*$/;
const EXPLICIT_ID_FIELD_COUNT = 3;

const knownIds = new Set<string>([
  "a 1",
  "task1",
  "task2",
  "task3",
  "after",
  "until",
]);
let initialized = false;

function assertGanttDb(db: unknown, diagramType: string): MermaidGanttDb {
  const candidate = db as Record<string, unknown>;
  const missing = REQUIRED_DB_FUNCTIONS.filter(
    (name) => typeof candidate[name] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `mermaid internal API changed: the ${diagramType} db lacks ${missing.join(", ")}`,
    );
  }
  return db as MermaidGanttDb;
}

function ensureInitialized(): void {
  if (initialized) return;
  mermaid.initialize(buildMermaidConfig({}));
  initialized = true;
}

export function rememberGanttIds(source: string): void {
  for (const match of source.matchAll(ID_WORD_PATTERN)) knownIds.add(match[0]);
}

// Re-registers every known id at a position later than any chart under test, and overwrites
// the `undefined` key a four-field task writes.
export async function isolateMermaidGanttState(): Promise<void> {
  ensureInitialized();
  const lines = ["gantt", "dateFormat YYYY-MM-DD"];
  for (let index = 0; index < POISON_FILLER_COUNT; index += 1) {
    lines.push(`p${index} :pz${index}, 2024-01-01, 1d`);
  }
  for (const id of knownIds) {
    if (!/[,\n]/.test(id)) lines.push(`q :${id}, 2024-01-01, 1d`);
  }
  lines.push("u :2024-01-01, 1d, 1d, 1d");
  await mermaid.parse(lines.join("\n"));
}

function faceValue(value: unknown): number | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    value.getHours(),
    value.getMinutes(),
  );
}

// An id counts as written when the data (after the tags) has three fields.
export function hasExplicitId(rawData: string | undefined): boolean {
  if (rawData === undefined) return false;
  let fields = (rawData.startsWith(":") ? rawData.slice(1) : rawData).split(
    ",",
  );
  while (fields.length > 0 && TAG_PATTERN.test(fields[0] as string)) {
    fields = fields.slice(1);
  }
  return fields.length === EXPLICIT_ID_FIELD_COUNT;
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_MESSAGE_LENGTH);
}

export async function readGanttWithMermaid(
  source: string,
): Promise<MermaidGanttReading> {
  rememberGanttIds(source);
  try {
    await isolateMermaidGanttState();
    await mermaid.parse(source);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    const raw = diagram.db as unknown as Record<string, unknown>;
    if (
      typeof raw.getSections !== "function" ||
      typeof raw.getTasks !== "function"
    ) {
      return { accepted: false, message: `not a gantt chart: ${diagram.type}` };
    }
    const db = assertGanttDb(raw, diagram.type);
    let tasks: DbTask[] | null = null;
    let tasksError: string | null = null;
    try {
      tasks = db.getTasks().map((task) => ({
        id: task.id,
        section: decodeMermaidMarkers(task.section),
        name: decodeMermaidMarkers(task.task).trim(),
        flags: FLAG_NAMES.filter((flag) => task[flag] === true),
        rawData: task.raw?.data ?? "",
        startKind: task.raw?.startTime?.type ?? "",
        startData: task.raw?.startTime?.startData ?? "",
        endData: task.raw?.endTime?.data ?? "",
        start: faceValue(task.startTime),
        end: faceValue(task.endTime),
      }));
    } catch (error) {
      tasksError = messageOf(error);
    }
    return {
      accepted: true,
      db: {
        dateFormat: db.getDateFormat(),
        axisFormat: db.getAxisFormat(),
        tickInterval: db.getTickInterval() ?? "",
        todayMarker: db.getTodayMarker(),
        excludes: [...db.getExcludes()],
        includes: [...db.getIncludes()],
        weekday: db.getWeekday(),
        inclusive: db.endDatesAreInclusive(),
        topAxis: db.topAxisEnabled(),
        title: decodeMermaidMarkers(db.getDiagramTitle()),
        sections: db.getSections().map(decodeMermaidMarkers),
        links: [...db.getLinks().entries()],
        tasks,
        tasksError,
      },
    };
  } catch (error) {
    return { accepted: false, message: messageOf(error) };
  }
}
