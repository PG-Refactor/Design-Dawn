// TEST ONLY. Reads what Mermaid 12.3.0 itself holds after reading a sequence diagram, through
// its internal diagram API (`mermaid.mermaidAPI.getDiagramFromText(...).db`). That API is not
// public and may change with the library version; nothing in the app uses it. It is the
// independent reference the domain's SequenceMeaning is compared against (as text lines, see
// sequence-comparison.ts). If the shape of the db changes, this file throws "internal API
// changed" instead of comparing nothing.
import mermaid from "mermaid";
import { buildMermaidConfig } from "../mermaid-config";
import { decodeMermaidMarkers } from "./mermaid-pie-db";

// What a diagram reads as, in one comparable shape: one string per participant and per db
// entry. The strings are built by the same functions for both sides.
export interface ComparableSequence {
  readonly participants: readonly string[];
  readonly items: readonly string[];
  readonly title: string;
  readonly chainConsistent: boolean;
}

export type MermaidSequenceReading =
  | { readonly accepted: true; readonly sequence: ComparableSequence }
  | { readonly accepted: false; readonly message: string };

interface DbActor {
  description: string;
  type: string;
  prevActor?: string;
  nextActor?: string;
}

interface DbMessage {
  from?: string;
  to?: string;
  type?: number;
  message?: unknown;
  activate?: boolean;
  centralConnection?: number;
  placement?: number;
}

interface MermaidSequenceDb {
  getActors(): Map<string, DbActor>;
  getMessages(): DbMessage[];
  getDiagramTitle(): string;
  getBoxes(): unknown[];
  getCreatedActors(): Map<string, number>;
  getDestroyedActors(): Map<string, number>;
}

const REQUIRED_DB_FUNCTIONS = [
  "getActors",
  "getMessages",
  "getDiagramTitle",
  "getBoxes",
  "getCreatedActors",
  "getDestroyedActors",
] as const;

// The db's message types (LINETYPE in mermaid's sequence db) that the domain models.
export const DB_ARROW_TYPES: Readonly<Record<number, string>> = {
  0: "->>",
  1: "-->>",
  3: "-x",
  4: "--x",
  5: "->",
  6: "-->",
  24: "-)",
  25: "--)",
  33: "<<->>",
  34: "<<-->>",
};
export const DB_NOTE_TYPE = 2;
export const DB_ACTIVATE_TYPE = 17;
export const DB_DEACTIVATE_TYPE = 18;
export const DB_AUTONUMBER_TYPE = 26;
export const DB_NOTE_PLACEMENTS: Readonly<Record<number, string>> = {
  0: "leftOf",
  1: "rightOf",
  2: "over",
};
export const DB_BLOCK_START_TYPES: Readonly<Record<number, string>> = {
  10: "loop",
  12: "alt",
  15: "opt",
  19: "par",
  22: "rect",
  27: "critical",
  30: "break",
  32: "par_over",
};
export const DB_BRANCH_TYPES: Readonly<Record<number, string>> = {
  13: "else",
  20: "and",
  28: "option",
};
// `par_over` ends with the same entry as `par`.
export const DB_BLOCK_END_TYPES: Readonly<Record<number, string>> = {
  11: "loop",
  14: "alt",
  16: "opt",
  21: "par",
  23: "rect",
  29: "critical",
  31: "break",
};

export function comparableMessage(text: unknown): string {
  return typeof text === "string"
    ? decodeMermaidMarkers(text)
    : JSON.stringify(text);
}

export function comparableParticipant(
  id: string,
  label: string,
  kind: string,
): string {
  return `${id}${label === id ? "" : `=${label}`}${kind === "participant" ? "" : `:${kind}`}`;
}

export function comparableAutonumber(
  visible: boolean,
  start: number | null,
  step: number | null,
): string {
  // Fixed key order, and absent when not given (what JSON does with `undefined`).
  return `auto ${JSON.stringify({
    start: start ?? undefined,
    step: step ?? undefined,
    visible,
  })}`;
}

function assertSequenceDb(db: unknown, diagramType: string): MermaidSequenceDb {
  const candidate = db as Record<string, unknown>;
  const missing = REQUIRED_DB_FUNCTIONS.filter(
    (name) => typeof candidate[name] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `mermaid internal API changed: the ${diagramType} db lacks ${missing.join(", ")}`,
    );
  }
  return db as MermaidSequenceDb;
}

function itemOf(message: DbMessage): string {
  const type = message.type;
  const text = comparableMessage(message.message);
  if (type !== undefined && DB_ARROW_TYPES[type] !== undefined) {
    return `msg ${message.from}>${message.to} ${DB_ARROW_TYPES[type]} ${JSON.stringify(text)}${message.activate === true ? " +" : ""}${message.centralConnection ? ` c${message.centralConnection}` : ""}`;
  }
  if (type === DB_ACTIVATE_TYPE) return `act+ ${message.from}`;
  if (type === DB_DEACTIVATE_TYPE) return `act- ${message.from}`;
  if (type === DB_NOTE_TYPE) {
    return `note ${DB_NOTE_PLACEMENTS[message.placement ?? -1]} ${message.from}>${message.to} ${JSON.stringify(text)}`;
  }
  if (type === DB_AUTONUMBER_TYPE) {
    // Mermaid keeps the argument as an object (or, in other versions, as JSON text).
    const argument = (
      typeof message.message === "string"
        ? JSON.parse(message.message)
        : message.message
    ) as {
      start?: number | string;
      step?: number | string;
      visible: boolean;
    };
    return comparableAutonumber(
      argument.visible,
      argument.start === undefined ? null : Number(argument.start),
      argument.step === undefined ? null : Number(argument.step),
    );
  }
  if (type !== undefined && DB_BLOCK_START_TYPES[type] !== undefined) {
    return `blockStart ${DB_BLOCK_START_TYPES[type]} ${JSON.stringify(text)}`;
  }
  if (type !== undefined && DB_BRANCH_TYPES[type] !== undefined) {
    return `branch ${DB_BRANCH_TYPES[type]} ${JSON.stringify(text)}`;
  }
  if (type !== undefined && DB_BLOCK_END_TYPES[type] !== undefined) {
    return `blockEnd ${DB_BLOCK_END_TYPES[type]}`;
  }
  return `other type ${type} ${JSON.stringify(text)}`;
}

let initialized = false;

export async function readSequenceWithMermaid(
  source: string,
): Promise<MermaidSequenceReading> {
  // Same configuration as the app (strict security level, secure keys), so the limits
  // behave as in the preview.
  if (!initialized) {
    mermaid.initialize(buildMermaidConfig({}));
    initialized = true;
  }
  try {
    await mermaid.parse(source);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    const db = diagram.db as unknown as Record<string, unknown>;
    if (typeof db.getActors !== "function") {
      if (/sequence/i.test(diagram.type)) assertSequenceDb(db, diagram.type);
      return { accepted: false, message: `not a sequence: ${diagram.type}` };
    }
    const sequence = assertSequenceDb(db, diagram.type);
    const actors = [...sequence.getActors().entries()];
    const ids = actors.map(([id]) => id);
    return {
      accepted: true,
      sequence: {
        participants: actors.map(([id, actor]) =>
          comparableParticipant(
            id,
            decodeMermaidMarkers(actor.description),
            actor.type,
          ),
        ),
        items: [
          ...sequence.getMessages().map(itemOf),
          ...[...sequence.getCreatedActors().keys()].map(
            (id) => `create ${id}`,
          ),
          ...[...sequence.getDestroyedActors().keys()].map(
            (id) => `destroy ${id}`,
          ),
          ...sequence.getBoxes().map(() => "box"),
        ],
        title: decodeMermaidMarkers(sequence.getDiagramTitle()),
        chainConsistent: actors.every(
          ([, actor], position) =>
            actor.prevActor === ids[position - 1] &&
            actor.nextActor === ids[position + 1],
        ),
      },
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("mermaid internal API")
    ) {
      throw error;
    }
    return {
      accepted: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
