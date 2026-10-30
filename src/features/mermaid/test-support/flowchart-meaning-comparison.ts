// TEST ONLY. Turns the domain's FlowchartMeaning into the shape the Mermaid db reading has
// (mermaid-flowchart-db.ts) and compares the two. No Mermaid import here.
import type { FlowchartMeaning } from "../../../domain/diagram/flowchart/flowchart-meaning";
import type { ComparableMeaning, ComparableNode } from "./mermaid-flowchart-db";

// Mermaid rewrites `<` `>` `&` `#` (markup and entities), backticks and backslashes before
// it stores a text (sanitiser, `<br>` handling, entity markers), so a text containing any of
// them is not compared: the reader keeps the text as written. Every other text must be equal.
const REWRITTEN_TEXT_PATTERN = /[<>&#`\\]/;

export function isComparableText(text: string): boolean {
  return !REWRITTEN_TEXT_PATTERN.test(text);
}

// Mermaid holds style pieces as written, blanks included (`" fill:blue"`); the db reading
// trims them (mermaid-flowchart-db.ts), and so does this side.
const trimmed = (styles: readonly string[] | null): readonly string[] | null =>
  styles === null ? null : styles.map((style) => style.trim());

export function comparableOf(meaning: FlowchartMeaning): ComparableMeaning {
  return {
    direction: meaning.direction,
    nodes: meaning.nodes.map(
      (node): ComparableNode => ({
        id: node.id,
        text: node.text,
        labelType: node.labelType,
        shape: node.shape,
        classes: node.classes,
        styles: trimmed(node.styles) ?? [],
        hasLink: node.hasLink,
        hasTooltip: node.hasTooltip,
      }),
    ),
    edges: meaning.edges.map((edge) => ({
      id: edge.id,
      userDefinedId: edge.userDefinedId,
      start: edge.start,
      end: edge.end,
      type: edge.type,
      stroke: edge.stroke,
      length: edge.length,
      text: edge.text,
      labelType: edge.labelType,
      style: trimmed(edge.style),
      interpolate: edge.interpolate,
      classes: edge.classes,
      animate: edge.animate,
      animation: edge.animation,
    })),
    subgraphs: meaning.subgraphs.map((subgraph) => ({
      id: subgraph.id,
      title: subgraph.title,
      labelType: subgraph.labelType,
      members: [...subgraph.members].sort(),
      direction: subgraph.direction,
      classes: subgraph.classes,
    })),
    classDefs: meaning.classDefs.map((classDef) => ({
      name: classDef.name,
      styles: trimmed(classDef.styles) ?? [],
    })),
    edgeDefaults: {
      style: trimmed(meaning.edgeDefaults.style),
      interpolate: meaning.edgeDefaults.interpolate,
    },
  };
}

// Blanks out the texts that are not compared, on both sides, so a plain `toEqual` works.
function maskTexts(
  own: ComparableMeaning,
  reference: ComparableMeaning,
): { readonly own: ComparableMeaning; readonly reference: ComparableMeaning } {
  const mask = (text: string, other: string | undefined): string =>
    isComparableText(text) && (other === undefined || isComparableText(other))
      ? text
      : "<not compared>";
  const maskSide = (side: ComparableMeaning, other: ComparableMeaning) => ({
    ...side,
    nodes: side.nodes.map((node, index) => ({
      ...node,
      text: mask(node.text, other.nodes[index]?.text),
    })),
    edges: side.edges.map((edge, index) => ({
      ...edge,
      text: mask(edge.text, other.edges[index]?.text),
    })),
    subgraphs: side.subgraphs.map((subgraph, index) => ({
      ...subgraph,
      title: mask(subgraph.title, other.subgraphs[index]?.title),
    })),
  });
  return { own: maskSide(own, reference), reference: maskSide(reference, own) };
}

export function maskedForComparison(
  own: ComparableMeaning,
  reference: ComparableMeaning,
) {
  return maskTexts(own, reference);
}

// The first section that differs, for a failure message.
export function firstDifference(
  own: ComparableMeaning,
  reference: ComparableMeaning,
): string | null {
  const masked = maskTexts(own, reference);
  for (const section of Object.keys(
    masked.own,
  ) as (keyof ComparableMeaning)[]) {
    const left = JSON.stringify(masked.own[section]);
    const right = JSON.stringify(masked.reference[section]);
    if (left !== right) {
      return `${section}: reader=${left.slice(0, 300)} mermaid=${right.slice(0, 300)}`;
    }
  }
  return null;
}
