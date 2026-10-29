// TEST ONLY. A seeded generator of random flowchart programs for the differential test
// (flowchart-reader.real.dom.test.ts). It is a typed rewrite of the generator of the Step 9-5
// research (project-authored). The programs mix chains, `&` lists, edge ids, `@{}` nodes,
// subgraphs, classes, styles, clicks, comments and several statements per line; whether
// Mermaid accepts one is decided by Mermaid at test time, not by the generator.

export type RandomSource = () => number;

const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_RANGE = 2 ** 32;

// Same linear congruential generator for every run: the programs must not change between
// runs, or a failure could not be reproduced.
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
    return state / UINT32_RANGE;
  };
}

const NODE_IDS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "n-1",
  "日本",
  "x1",
  "o2",
  "Node_3",
] as const;
const MIN_POOL_SIZE = 4;
const POOL_SIZE_SPREAD = 8;
const BRACKET_FORMS: readonly (readonly [string, string])[] = [
  ["[", "]"],
  ["(", ")"],
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["((", "))"],
  ["(((", ")))"],
  [">", "]"],
  ["{", "}"],
  ["{{", "}}"],
  ["[/", "/]"],
  ["[\\", "\\]"],
  ["[/", "\\]"],
  ["[\\", "/]"],
];
const UNQUOTED_LABELS = [
  "Start",
  "hello world",
  "x y z",
  "日本語",
  "50 off",
  "a-b",
  "Q?",
] as const;
const QUOTED_LABELS = [
  "with (parens)",
  "pipe | bar",
  "semi; colon",
  "end",
  "a<br/>b",
  "%% not comment",
  "ünï",
  "x[y]",
] as const;
const LINKS = [
  "-->",
  "---",
  "-.->",
  "-.-",
  "==>",
  "===",
  "--o",
  "--x",
  "<-->",
  "<-.->",
  "<==>",
  "o--o",
  "x--x",
  "~~~",
  "--->",
  "-..->",
  "====>",
] as const;
const PIPE_LABELS = ["yes", "no", '"quoted, label"', '"a | b"'] as const;
const INLINE_LABELS = ["inline", "two words"] as const;
const AT_BLOCK_SHAPES = [
  "rect",
  "cyl",
  "doc",
  "hex",
  "diam",
  "circle",
] as const;
const AT_BLOCK_LABELS = ["Hi", "Store", "a b"] as const;
const CLASS_NAMES = ["k1", "k2"] as const;
const INDENTS = ["", "    ", "\t"] as const;
const KEYWORDS = ["flowchart", "graph"] as const;
const DIRECTIONS = ["TD", "LR", "TB", "RL", "BT"] as const;
const SUBGRAPH_HEADERS = (number: number): readonly string[] => [
  `S${number}`,
  `S${number} [Title ${number}]`,
  `S${number} ["Quoted (${number})"]`,
  `S${number} [Plain ${number}]`,
];
const SUBGRAPH_DIRECTIONS = ["LR", "TB"] as const;
const MAX_SUBGRAPH_DEPTH = 2;
const MIN_STATEMENTS = 3;
const STATEMENT_SPREAD = 8;
const MAX_CHAIN_LINKS = 3;
const LINK_STYLE_PROBABILITY = 0.4;
const LINK_STYLE_IN_RANGE_PROBABILITY = 0.9;
const EDGE_ID_PROBABILITY = 0.12;

export type EdgeCounter = (program: string) => Promise<number>;

export async function generateProgram(
  random: RandomSource,
  countEdges: EdgeCounter,
): Promise<string> {
  const pick = <Value>(values: readonly Value[]): Value =>
    values[Math.floor(random() * values.length)] as Value;
  const pool = NODE_IDS.slice(
    0,
    MIN_POOL_SIZE + Math.floor(random() * POOL_SIZE_SPREAD),
  );
  let edgeIdSequence = 0;

  const term = (allowAtBlock: boolean): string => {
    const id = pick(pool);
    const roll = random();
    if (roll < 0.35) return id;
    if (roll < 0.7) {
      const [opener, closer] = pick(BRACKET_FORMS);
      const label =
        random() < 0.5 ? `"${pick(QUOTED_LABELS)}"` : pick(UNQUOTED_LABELS);
      return `${id}${opener}${label}${closer}`;
    }
    if (roll < 0.8 && allowAtBlock) {
      const labelPart =
        random() < 0.6 ? `, label: "${pick(AT_BLOCK_LABELS)}"` : "";
      return `${id}@{ shape: ${pick(AT_BLOCK_SHAPES)}${labelPart} }`;
    }
    if (roll < 0.9) return `${id}:::${pick(CLASS_NAMES)}`;
    return id;
  };
  const group = (): string => {
    const count = random() < 0.8 ? 1 : 2 + Math.floor(random() * 2);
    return Array.from({ length: count }, () => term(false)).join(" & ");
  };
  const link = (): string => {
    const token = pick(LINKS);
    const roll = random();
    const edgeId =
      random() < EDGE_ID_PROBABILITY ? `e${++edgeIdSequence}@` : "";
    if (roll < 0.2 && !token.startsWith("~")) {
      return ` ${edgeId}${token}|${pick(PIPE_LABELS)}| `;
    }
    if (roll < 0.3 && token === "-->") {
      return ` -- ${pick(INLINE_LABELS)} --> `;
    }
    if (roll < 0.35 && token === "-.->") return " -. dotted text .-> ";
    return ` ${edgeId}${token} `;
  };
  const statement = (): string => {
    if (random() < 0.1) return term(true);
    const chainLinks = 1 + Math.floor(random() * MAX_CHAIN_LINKS);
    let text = group();
    for (let index = 0; index < chainLinks; index += 1) {
      text += link() + group();
    }
    return text;
  };

  const body: string[] = [];
  const statementCount =
    MIN_STATEMENTS + Math.floor(random() * STATEMENT_SPREAD);
  let openSubgraphs = 0;
  let subgraphNumber = 0;
  for (let index = 0; index < statementCount; index += 1) {
    const roll = random();
    const indent = pick(INDENTS);
    if (roll < 0.12 && openSubgraphs < MAX_SUBGRAPH_DEPTH) {
      subgraphNumber += 1;
      body.push(`${indent}subgraph ${pick(SUBGRAPH_HEADERS(subgraphNumber))}`);
      openSubgraphs += 1;
      if (random() < 0.5) {
        body.push(`${indent}  direction ${pick(SUBGRAPH_DIRECTIONS)}`);
      }
    } else if (roll < 0.2 && openSubgraphs > 0) {
      body.push(`${indent}end`);
      openSubgraphs -= 1;
    } else if (roll < 0.24) {
      body.push(`${indent}%% comment ${index}`);
    } else if (roll < 0.27) {
      body.push("");
    } else if (roll < 0.32) {
      body.push(`${indent}${statement()}; ${statement()}`);
    } else if (roll < 0.34) {
      body.push(`${indent}${statement()};`);
    } else {
      body.push(indent + statement());
    }
  }
  while (openSubgraphs > 0) {
    body.push("end");
    openSubgraphs -= 1;
  }

  const tail: string[] = [];
  if (random() < 0.5) {
    tail.push("classDef k1 fill:#f96,stroke:#333", "classDef k2 stroke:#0a0");
  }
  if (random() < 0.3) {
    tail.push(`class ${pick(pool)},${pick(pool)} ${pick(CLASS_NAMES)}`);
  }
  if (random() < 0.3) tail.push(`style ${pick(pool)} fill:#bbf,stroke:#000`);
  if (random() < 0.3) {
    tail.push(`click ${pick(pool)} "https://example.com" "tip"`);
  }
  const header = `${pick(KEYWORDS)} ${pick(DIRECTIONS)}`;
  const program = `${[header, body.join("\n"), ...tail].join("\n")}\n`;
  if (random() < LINK_STYLE_PROBABILITY) {
    // The index comes from Mermaid's own edge count, never from the reader under test.
    const count = await countEdges(program);
    if (count > 0) {
      const index =
        random() < LINK_STYLE_IN_RANGE_PROBABILITY
          ? Math.floor(random() * count)
          : count + 1;
      return `${program}linkStyle ${index} stroke:#f00,stroke-width:2px\n`;
    }
  }
  return program;
}
