// @vitest-environment jsdom
// The real Mermaid library with the real sanitiser, in jsdom. jsdom cannot measure text,
// so the measuring APIs are faked below and every layout value is meaningless: these tests
// check structure (what survives sanitising), never how a diagram looks. Whether the
// diagrams look right in the WebView is a manual check.
import { beforeAll, describe, expect, it } from "vitest";
import { readSequenceView } from "../../domain/diagram/sequence/sequence-view";
import { readDiagramShapes } from "./diagram-shapes";
import {
  buildMermaidConfig,
  MERMAID_DEFAULT_SECURE_KEYS,
} from "./mermaid-config";
import type { MermaidThemeValues } from "./mermaid-renderer-types";
import { MERMAID_TEMPLATE_IDS, MERMAID_TEMPLATES } from "./mermaid-templates";
import { mermaidRenderer } from "./render-mermaid";
import {
  THEME_TOKENS,
  type ThemeVariable,
  withNonTokenValues,
} from "./resolve-mermaid-theme";
import { sanitizeSvg } from "./sanitize-svg";

const fixtureSources = import.meta.glob("/fixtures/mermaid/*.mmd", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FAKE_CHARACTER_WIDTH = 8;
const FAKE_LINE_HEIGHT = 16;

// Words that must still be drawn as SVG text after sanitising, per fixture.
const EXPECTED_LABELS: Readonly<Record<string, readonly string[]>> = {
  flowchart: ["Alpha start", "Bravo check", "Charlie done", "処理を再試行"],
  state: ["Idle", "Delta begin", "Echo finish"],
  sequence: ["Foxtrot", "Golf", "Hotel request", "India reply"],
  er: ["JULIET", "KILO", "places", "lima", "mike"],
  class: ["November", "oscar", "papa", "Quebec"],
  gantt: ["Romeo plan", "Sierra", "Tango task", "Uniform task"],
  mindmap: ["Victor", "Whiskey", "Xray", "Yankee"],
};
// Diagram types that draw arrowheads or line ends with <marker>.
const TYPES_WITH_MARKERS = ["flowchart", "state", "class", "er", "sequence"];

beforeAll(() => {
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  proto.getBBox = function (this: SVGElement) {
    return {
      x: 0,
      y: 0,
      width: (this.textContent ?? "").length * FAKE_CHARACTER_WIDTH,
      height: FAKE_LINE_HEIGHT,
    };
  };
  proto.getComputedTextLength = function (this: SVGElement) {
    return (this.textContent ?? "").length * FAKE_CHARACTER_WIDTH;
  };
  proto.getTotalLength = () => FAKE_LINE_HEIGHT;
  proto.getPointAtLength = () => ({ x: 0, y: 0 });
  // Mind maps are laid out by cytoscape, which asks a canvas for text widths.
  const canvasContext = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "measureText"
          ? (text: string) => ({ width: text.length * FAKE_CHARACTER_WIDTH })
          : () => undefined,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    canvasContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const fixtures = Object.entries(fixtureSources).map(([path, source]) => ({
  name: path.replace(/^.*\//, "").replace(/\.mmd$/, ""),
  source,
}));

function parseSvg(text: string): Document {
  return new DOMParser().parseFromString(text, "image/svg+xml");
}

function externalUrlReferences(document: Document): string[] {
  const found: string[] = [];
  const pattern = /url\(\s*["']?(?!#)[^)]*\)/gi;
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      if (pattern.test(attribute.value)) found.push(attribute.name);
      pattern.lastIndex = 0;
    }
    if (
      element.localName === "style" &&
      pattern.test(element.textContent ?? "")
    ) {
      found.push("style element");
    }
    pattern.lastIndex = 0;
  }
  return found;
}

describe("the Mermaid fixtures", () => {
  it("cover every supported diagram type", () => {
    expect(fixtures.map((fixture) => fixture.name).sort()).toEqual(
      Object.keys(EXPECTED_LABELS).sort(),
    );
  });
});

describe.each(fixtures.map(({ name, source }) => [name, source] as const))(
  "real Mermaid output of %s.mmd",
  (name, source) => {
    it("renders, and the sanitised SVG is well-formed XML without active content", async () => {
      const outcome = await mermaidRenderer.render(source, {});
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      const sanitized = sanitizeSvg(outcome.svg);
      const document = parseSvg(sanitized);
      expect(document.querySelector("parsererror")).toBeNull();
      expect(document.documentElement.localName).toBe("svg");

      const forbidden = document.querySelectorAll(
        "script, foreignObject, iframe, object, embed, image, a",
      );
      expect(forbidden).toHaveLength(0);
      const handlers = [...document.querySelectorAll("*")].flatMap((element) =>
        [...element.attributes]
          .filter((attribute) => attribute.name.toLowerCase().startsWith("on"))
          .map((attribute) => attribute.name),
      );
      expect(handlers).toEqual([]);
      const references = [...document.querySelectorAll("[href], [*|href]")]
        .map(
          (element) =>
            element.getAttribute("href") ??
            element.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
            "",
        )
        .filter((value) => !value.startsWith("#"));
      expect(references).toEqual([]);
      expect(externalUrlReferences(document)).toEqual([]);
    });

    it("keeps the label text as SVG text", async () => {
      const outcome = await mermaidRenderer.render(source, {});
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const document = parseSvg(sanitizeSvg(outcome.svg));
      const drawnText = [...document.querySelectorAll("text, tspan")]
        .map((element) => element.textContent ?? "")
        .join(" ");
      for (const label of EXPECTED_LABELS[name] ?? []) {
        expect(drawnText, `label "${label}"`).toContain(label);
      }
    });

    it("keeps the internal references (markers, gradients) it started with", async () => {
      const outcome = await mermaidRenderer.render(source, {});
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const raw = parseSvg(outcome.svg);
      const clean = parseSvg(sanitizeSvg(outcome.svg));
      expect(raw.querySelector("parsererror")).toBeNull();
      const markersBefore = raw.querySelectorAll("marker").length;
      expect(clean.querySelectorAll("marker")).toHaveLength(markersBefore);
      if (TYPES_WITH_MARKERS.includes(name)) {
        expect(markersBefore).toBeGreaterThan(0);
      }
      const referencesBefore = raw.querySelectorAll(
        '[marker-end*="url(#"]',
      ).length;
      expect(clean.querySelectorAll('[marker-end*="url(#"]')).toHaveLength(
        referencesBefore,
      );
    });

    it("leaves every url(#...) reference and the stylesheet exactly as Mermaid wrote them", async () => {
      const outcome = await mermaidRenderer.render(source, {});
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const raw = parseSvg(outcome.svg);
      const clean = parseSvg(sanitizeSvg(outcome.svg));
      const internalReferences = (document: Document) =>
        [...document.querySelectorAll("*")].flatMap((element) =>
          [...element.attributes]
            .filter((attribute) => attribute.value.includes("url("))
            .map((attribute) => `${attribute.name}=${attribute.value}`),
        );
      // Every url( Mermaid writes is internal, and none of them was touched.
      expect(internalReferences(clean)).toEqual(internalReferences(raw));
      expect(clean.querySelector("style")?.textContent).toBe(
        raw.querySelector("style")?.textContent,
      );
      expect(raw.querySelector("style")?.textContent?.length).toBeGreaterThan(
        0,
      );
    });

    it("had no foreignObject to begin with (htmlLabels: false)", async () => {
      const outcome = await mermaidRenderer.render(source, {});
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.svg.toLowerCase()).not.toContain("<foreignobject");
    });
  },
);

describe("real Mermaid with invalid source", () => {
  it("returns an error value, leaves nothing in the page and renders the next diagram", async () => {
    const failed = await mermaidRenderer.render(
      "flowchart TD\n  A --> --> ((",
      {},
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.message.length).toBeGreaterThan(0);
    expect(document.body.children).toHaveLength(0);

    const next = await mermaidRenderer.render("flowchart TD\n  A --> B", {});
    expect(next.ok).toBe(true);
  });

  it("does not draw an error diagram for unknown diagram types", async () => {
    const failed = await mermaidRenderer.render("notADiagram\n  x", {});
    expect(failed.ok).toBe(false);
    expect(document.body.children).toHaveLength(0);
  });
});

const LABEL_SOURCE = "flowchart TD\n  A[Hello] --> B[World]";

async function renderRawAndClean(source: string) {
  const outcome = await mermaidRenderer.render(source, {});
  if (!outcome.ok) throw new Error(outcome.message);
  return { raw: outcome.svg, clean: sanitizeSvg(outcome.svg) };
}

describe("real Mermaid: directives cannot turn HTML labels or the security level back", () => {
  it("exposes the default secure list that mermaid-config.ts repeats", async () => {
    const mermaid = (await import("mermaid")).default;
    expect(mermaid.mermaidAPI.defaultConfig.secure).toEqual([
      ...MERMAID_DEFAULT_SECURE_KEYS,
    ]);
  });

  it("draws labels as SVG text without any directive", async () => {
    const { raw, clean } = await renderRawAndClean(LABEL_SOURCE);
    expect(raw).not.toMatch(/foreignObject/i);
    expect(clean).toContain("Hello");
  });

  it.each([
    ["an init directive", `%%{init: {"htmlLabels": true}}%%\n${LABEL_SOURCE}`],
    [
      "YAML front matter",
      `---\nconfig:\n  htmlLabels: true\n---\n${LABEL_SOURCE}`,
    ],
  ])("ignores htmlLabels: true from %s", async (_name, source) => {
    const { raw, clean } = await renderRawAndClean(source);
    expect(raw).not.toMatch(/foreignObject/i);
    expect(/<text/.test(raw)).toBe(true);
    expect(clean).toContain("Hello");
  });

  it.each([
    [
      "an init directive",
      `%%{init: {"flowchart": {"htmlLabels": true}}}%%\n${LABEL_SOURCE}`,
    ],
    [
      "YAML front matter",
      `---\nconfig:\n  flowchart:\n    htmlLabels: true\n---\n${LABEL_SOURCE}`,
    ],
  ])(
    "records what the diagram-specific htmlLabels from %s does (measured with Mermaid 12.3.0: nothing, the labels stay SVG text)",
    async (_name, source) => {
      const { raw, clean } = await renderRawAndClean(source);
      // If a future Mermaid honours this and emits foreignObject, the sanitiser must
      // still leave an image without active content (labels may then disappear).
      expect(clean).not.toMatch(/foreignObject|<script|<iframe/i);
      const dom = parseSvg(clean);
      expect(dom.querySelector("parsererror")).toBeNull();
      expect(raw).not.toMatch(/foreignObject/i);
      expect(clean).toContain("Hello");
    },
  );

  it("keeps the security level strict when a directive asks for loose", async () => {
    const source = `flowchart TD\n  A[Hello] --> B\n  click A "https://example.invalid/page" "tip"`;
    const withoutDirective = await renderRawAndClean(source);
    const withDirective = await renderRawAndClean(
      `%%{init: {"securityLevel": "loose"}}%%\n${source}`,
    );
    // The render ids differ per call; everything else must be identical.
    const normalise = (svg: string) => svg.replace(/dawn-mermaid-\d+/g, "id");
    expect(
      normalise(withDirective.raw) === normalise(withoutDirective.raw),
    ).toBe(true);
  });

  it("draws a click link even at the strict level (so the sanitiser's removal of <a> is what keeps links out)", async () => {
    const { raw, clean } = await renderRawAndClean(
      `flowchart TD\n  A[Hello] --> B\n  click A "https://example.invalid/page" "tip"`,
    );
    expect(/<a[ >]/.test(raw)).toBe(true);
    expect(/<a[ >]/.test(clean)).toBe(false);
    expect(clean.includes("example.invalid")).toBe(false);
    expect(clean).toContain("Hello");
  });

  it("removes an external url in a themeCSS directive in the sanitiser (themeCSS is not restricted)", async () => {
    const { raw, clean } = await renderRawAndClean(
      `%%{init: {"themeCSS": ".node rect{fill:url(\\"http://example.invalid/a)b\\");stroke:red}"}}%%\n${LABEL_SOURCE}`,
    );
    expect(raw.includes("http://example.invalid/a)b")).toBe(true);
    expect(clean.includes("example.invalid")).toBe(false);
    // Mermaid scopes the rule to the diagram id and ends each declaration with ";".
    expect(clean.includes(".node rect{stroke:red;}")).toBe(true);
  });

  it("shows that the root htmlLabels: false already wins over the diagram-specific key (measured without the extra secure key)", async () => {
    const mermaid = (await import("mermaid")).default;
    // This talks to the library directly and changes its global configuration, so the
    // app's configuration is put back afterwards: the renderer would not re-initialise
    // for an unchanged theme.
    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        suppressErrorRendering: true,
        theme: "base",
      });
      const diagramSpecific = await mermaid.render(
        "dawn-precedence-diagram",
        `%%{init: {"flowchart": {"htmlLabels": true}}}%%\n${LABEL_SOURCE}`,
      );
      expect(/foreignObject/i.test(diagramSpecific.svg)).toBe(false);
      // The same call with the root key does emit foreignObject, which is what `secure`
      // exists to prevent.
      const root = await mermaid.render(
        "dawn-precedence-root",
        `%%{init: {"htmlLabels": true}}%%\n${LABEL_SOURCE}`,
      );
      expect(/foreignObject/i.test(root.svg)).toBe(true);
    } finally {
      mermaid.initialize(buildMermaidConfig({}));
    }
  });
});

const themeTokenSources = import.meta.glob("/src/styles/theme-tokens.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const baseStyleSources = import.meta.glob("/src/styles/base.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function readThemeBlock(themeId: string): Map<string, string> {
  const css = Object.values(themeTokenSources)[0] ?? "";
  const start = css.indexOf(`:root[data-theme="${themeId}"]`);
  const end = css.indexOf("}", start);
  const values = new Map<string, string>();
  for (const match of css
    .slice(start, end)
    .matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    values.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return values;
}

// The same mapping resolveMermaidTheme applies to the computed style, applied to the CSS
// text instead because jsdom does not load stylesheets.
function themeValuesOf(themeId: string): MermaidThemeValues {
  const tokens = readThemeBlock(themeId);
  const baseCss = Object.values(baseStyleSources)[0] ?? "";
  const fontMatch = /--font-family-base:\s*([^;]+);/.exec(baseCss);
  tokens.set(
    "--font-family-base",
    (fontMatch?.[1] ?? "").replace(/\s+/g, " ").trim(),
  );
  const values: { -readonly [K in ThemeVariable]?: string } = {};
  for (const [variable, token] of THEME_TOKENS) {
    const value = tokens.get(token);
    if (value !== undefined && value !== "") values[variable] = value;
  }
  return withNonTokenValues(values, themeId === "dark");
}

// Mermaid puts the position of a `click` node on the <a> around it. jsdom layout values are fake, so these check that each node keeps the
// transform Mermaid gave it, not where it ends up on screen.
describe("real Mermaid: a clickable node keeps its position after the link is removed", () => {
  const nodeId = /-flowchart-([^-]+)-\d+$/;

  // The transform that places each node, keyed by node id: the node's own transform, or
  // that of the element directly around it (the <a> in raw output, its <g> after sanitising).
  function nodePositions(svg: string): Map<string, string | null> {
    const positions = new Map<string, string | null>();
    for (const node of parseSvg(svg).querySelectorAll("g.node")) {
      const id = nodeId.exec(node.getAttribute("id") ?? "")?.[1];
      if (id === undefined) continue;
      const parent = node.parentElement;
      const parentPlacesNode =
        parent !== null && !parent.classList.contains("nodes");
      positions.set(
        id,
        node.getAttribute("transform") ??
          (parentPlacesNode ? parent.getAttribute("transform") : null),
      );
    }
    return positions;
  }

  it("keeps the transform the link carried, with the shape and label inside", async () => {
    const { raw, clean } = await renderRawAndClean(
      `flowchart TD\n  A[Alpha] --> B[Beta]\n  click A "https://example.invalid/page" "tip"`,
    );
    const rawLink = parseSvg(raw).querySelector("a");
    expect(rawLink?.getAttribute("transform")).toMatch(/^translate\(/);

    const document = parseSvg(clean);
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(clean.includes("example.invalid")).toBe(false);
    const node = document.querySelector('g.node[id$="-flowchart-A-0"]');
    const wrapper = node?.parentElement;
    expect(wrapper?.localName).toBe("g");
    expect(wrapper?.getAttributeNames()).toEqual(["transform"]);
    expect(wrapper?.getAttribute("transform")).toBe(
      rawLink?.getAttribute("transform"),
    );
    expect(wrapper?.parentElement?.classList.contains("nodes")).toBe(true);
    expect(node?.querySelector("rect")).not.toBeNull();
    expect(node?.textContent).toContain("Alpha");
    expect(nodePositions(clean)).toEqual(nodePositions(raw));
  });

  it("keeps several clickable nodes at their own, different positions", async () => {
    const { raw, clean } = await renderRawAndClean(
      [
        "flowchart LR",
        "  A[Alpha] --> B(Beta) --> C{Gamma}",
        "  A --> D[(Delta)]",
        '  click A "https://example.invalid/a"',
        '  click B href "https://example.invalid/b" "tip"',
        "  click C callbackName",
        '  click D "javascript:alert(1)"',
      ].join("\n"),
    );
    const positions = nodePositions(clean);
    expect(positions).toEqual(nodePositions(raw));
    const values = [...positions.values()];
    expect(values).toHaveLength(4);
    expect(values.every((value) => value !== null)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
    const document = parseSvg(clean);
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(clean).not.toMatch(/example\.invalid|javascript|alert/);
    expect(clean).not.toMatch(/\son[a-z]+=/i);
    for (const label of ["Alpha", "Beta", "Gamma", "Delta"]) {
      expect(clean).toContain(label);
    }
  });

  it("leaves a flowchart without click exactly as before (no wrapper is added)", async () => {
    const { raw, clean } = await renderRawAndClean(
      "flowchart TD\n  A[Alpha] --> B[Beta] --> C[Gamma]",
    );
    expect(/<a[ >]/.test(raw)).toBe(false);
    const countGroups = (svg: string) =>
      parseSvg(svg).querySelectorAll("g").length;
    expect(countGroups(clean)).toBe(countGroups(raw));
    const positions = nodePositions(clean);
    expect(positions).toEqual(nodePositions(raw));
    expect([...positions.values()].every((value) => value !== null)).toBe(true);
  });
});

describe("real Mermaid with the app's theme token values", () => {
  it.each(["light", "dark"])(
    "renders with the %s theme and uses its colours",
    async (themeId) => {
      const theme = themeValuesOf(themeId);
      // A vacuous mapping would make the colour checks below pass for nothing.
      expect(
        THEME_TOKENS.every(([variable]) => theme[variable] !== undefined),
      ).toBe(true);
      const outcome = await mermaidRenderer.render(LABEL_SOURCE, theme);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const svg = sanitizeSvg(outcome.svg).toLowerCase();
      // What paints a flowchart: the node fill and outline (given explicitly, so a node
      // reads on a white page), the text, the border of other shapes and the edges.
      for (const variable of [
        "mainBkg",
        "nodeBorder",
        "primaryTextColor",
        "primaryBorderColor",
        "lineColor",
      ] as const) {
        expect(svg, `${themeId} ${variable}`).toContain(
          (theme[variable] ?? "").toLowerCase(),
        );
      }
    },
  );

  const PIE_SOURCE = `pie title Share\n  "Alpha" : 40\n  "Bravo" : 30\n  "Charlie" : 20\n  "Delta" : 10`;
  const GANTT_SOURCE = [
    "gantt",
    "  dateFormat YYYY-MM-DD",
    "  section Work",
    "  Planned task :t1, 2026-01-01, 5d",
    "  Active task :active, t2, 2026-01-06, 5d",
    "  Done task :done, t3, 2026-01-11, 5d",
    "  Critical task :crit, t4, 2026-01-16, 5d",
  ].join("\n");

  // The colour reaches the SVG as a style rule (a pie slice is drawn with an inline fill
  // from pie1..; the rest are `<style>` rules), so the check is on the lowercase text.
  it.each(["light", "dark"])(
    "draws a pie chart with the %s palette, not a derived colour",
    async (themeId) => {
      const theme = themeValuesOf(themeId);
      const outcome = await mermaidRenderer.render(PIE_SOURCE, theme);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const svg = sanitizeSvg(outcome.svg).toLowerCase();
      for (const variable of [
        "pie1",
        "pie2",
        "pie3",
        "pie4",
        "pieStrokeColor",
        "pieOuterStrokeColor",
        "pieSectionTextColor",
        "pieTitleTextColor",
        "pieLegendTextColor",
      ] as const) {
        expect(svg, `${themeId} ${variable}`).toContain(
          (theme[variable] ?? "").toLowerCase(),
        );
      }
      expect(svg).toMatch(/opacity:\s*1\b/);
    },
  );

  it.each(["light", "dark"])(
    "draws a gantt chart with the %s palette",
    async (themeId) => {
      const theme = themeValuesOf(themeId);
      const outcome = await mermaidRenderer.render(GANTT_SOURCE, theme);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const svg = sanitizeSvg(outcome.svg).toLowerCase();
      for (const variable of [
        "taskBkgColor",
        "taskBorderColor",
        "taskTextColor",
        "taskTextDarkColor",
        "taskTextOutsideColor",
        "activeTaskBkgColor",
        "activeTaskBorderColor",
        "doneTaskBkgColor",
        "doneTaskBorderColor",
        "critBkgColor",
        "critBorderColor",
        "sectionBkgColor",
        "altSectionBkgColor",
        "gridColor",
        "todayLineColor",
      ] as const) {
        expect(svg, `${themeId} ${variable}`).toContain(
          (theme[variable] ?? "").toLowerCase(),
        );
      }
    },
  );

  it("fails to render when a token is a colour format Mermaid cannot parse (the regression signal for a token format change)", async () => {
    for (const unsupported of ["color-mix(in srgb, red, blue)", "var(--x)"]) {
      const outcome = await mermaidRenderer.render(LABEL_SOURCE, {
        primaryColor: unsupported,
      });
      expect(outcome.ok, unsupported).toBe(false);
      if (!outcome.ok) expect(outcome.message).toContain("Unsupported color");
    }
  });
});

describe("the shapes of a real flowchart, for clicks on its picture", () => {
  it("finds every node by its id, with a box of its own", async () => {
    const outcome = await mermaidRenderer.render(
      'flowchart LR\n  start-node["Start"] --> B{Choice}\n  B --> C([Done])',
      themeValuesOf("light"),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const diagram = readDiagramShapes(sanitizeSvg(outcome.svg));
    expect(diagram?.shapes.map((shape) => shape.hit.id).sort()).toEqual([
      "B",
      "C",
      "start-node",
    ]);
    for (const shape of diagram?.shapes ?? []) {
      expect(shape.box.width).toBeGreaterThan(0);
      expect(shape.box.height).toBeGreaterThan(0);
    }
  });
});

describe("the edges and subgraphs of a real flowchart, for clicks on its picture", () => {
  it("finds every edge by its source id and the subgraph by its id", async () => {
    const outcome = await mermaidRenderer.render(
      "flowchart LR\n  subgraph grp-1 [Group]\n  A --> B\n  end\n  B -- yes --> C\n  C e1@-.-> A",
      themeValuesOf("light"),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const diagram = readDiagramShapes(sanitizeSvg(outcome.svg));
    expect(diagram?.lines.map((line) => line.hit.id).sort()).toEqual([
      "L_A_B_0",
      "L_B_C_0",
      "e1",
    ]);
    expect(diagram?.areas.map((area) => area.hit.id)).toEqual(["grp-1"]);
  });
});

describe("the shapes of real sequence and pie diagrams, for clicks on their picture", () => {
  it("finds participants, messages in order and notes", async () => {
    const outcome = await mermaidRenderer.render(
      "sequenceDiagram\n  participant A as Alice\n  participant B\n  A->>B: Hello\n  Note right of B: thinking\n  B-->>A: Hi\n  loop Every minute\n    A->>B: ping\n  end",
      themeValuesOf("light"),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const diagram = readDiagramShapes(sanitizeSvg(outcome.svg));
    const hits = (kind: string) =>
      [
        ...(diagram?.shapes ?? []).map((shape) => shape.hit),
        ...(diagram?.lines ?? []).map((line) => line.hit),
      ].filter((hit) => hit.kind === kind);
    expect(new Set(hits("participant").map((hit) => hit.id))).toEqual(
      new Set(["A", "B"]),
    );
    expect(hits("message").map((hit) => hit.ordinal)).toEqual([0, 1, 2]);
    expect(hits("note").map((hit) => hit.ordinal)).toEqual([0]);
  });

  it("finds one block area per block the editor lists, top to bottom", async () => {
    const source =
      "sequenceDiagram\n  A->>B: one\n  loop Outer\n    A->>B: two\n    opt Inner\n      B->>A: three\n    end\n  end\n  alt Yes\n    A->>B: four\n  else No\n    B->>A: five\n  end\n  rect rgb(200,200,255)\n    A->>B: six\n  end";
    const outcome = await mermaidRenderer.render(
      source,
      themeValuesOf("light"),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const blocks = (
      readDiagramShapes(sanitizeSvg(outcome.svg))?.areas ?? []
    ).filter((area) => area.hit.kind === "block");
    const listed = readSequenceView(source)?.entries.filter(
      (entry) => entry.kind === "blockStart",
    );
    expect(blocks.map((block) => block.hit.ordinal)).toEqual([0, 1, 2, 3]);
    expect(blocks).toHaveLength(listed?.length ?? -1);
    // The inner opt lies inside the outer loop.
    const [outer, inner] = blocks;
    expect(inner?.box.y).toBeGreaterThan(outer?.box.y ?? Number.NaN);
    expect((inner?.box.y ?? 0) + (inner?.box.height ?? 0)).toBeLessThan(
      (outer?.box.y ?? 0) + (outer?.box.height ?? 0),
    );
  });

  it("names every pie slice by its label", async () => {
    const outcome = await mermaidRenderer.render(
      'pie title Pets\n  "Dogs" : 40\n  "Cats" : 30\n  "Birds" : 10',
      themeValuesOf("light"),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const diagram = readDiagramShapes(sanitizeSvg(outcome.svg));
    expect(diagram?.wedges.map((wedge) => wedge.hit.id).sort()).toEqual([
      "Birds",
      "Cats",
      "Dogs",
    ]);
  });
});

describe("the Mermaid templates", () => {
  it.each(MERMAID_TEMPLATE_IDS)(
    "%s renders with real Mermaid",
    async (template) => {
      const outcome = await mermaidRenderer.render(
        MERMAID_TEMPLATES[template],
        themeValuesOf("light"),
      );
      expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    },
  );
});
