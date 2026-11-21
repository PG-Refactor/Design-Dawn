import { type DomainResult, err, ok } from "../shared/domain-result";

// BlockType definition table. Add a row here to introduce a new block type; do not
// branch on identifiers elsewhere. File extensions and directories live in Rust only.
// `scalable`: the content has a display size (−/+ and fitting to the Block);
// `fitsByDefault`: it is fitted to the Block when the file says nothing (a diagram cannot
// wrap, text can). Mirrors `content_scale.rs`.
export const BLOCK_TYPE_DEFINITIONS = {
  markdown: {
    identifier: "markdown",
    contentKind: "text",
    scalable: true,
    fitsByDefault: false,
  },
  mermaid: {
    identifier: "mermaid",
    contentKind: "text",
    scalable: true,
    fitsByDefault: true,
  },
  image: {
    identifier: "image",
    contentKind: "asset",
    scalable: false,
    fitsByDefault: false,
  },
} as const;

export type BlockType =
  (typeof BLOCK_TYPE_DEFINITIONS)[keyof typeof BLOCK_TYPE_DEFINITIONS]["identifier"];

export function parseBlockType(value: string): DomainResult<BlockType> {
  const definition = Object.values(BLOCK_TYPE_DEFINITIONS).find(
    (candidate) => candidate.identifier === value,
  );
  if (definition === undefined) {
    return err(
      "unsupportedBlockType",
      `unknown block type: ${JSON.stringify(value)}`,
    );
  }
  return ok(definition.identifier);
}

// Text blocks keep their body in a `blocks/` file that the application creates, reads
// and deletes; asset blocks (image) reference an imported asset instead.
export function isTextBlockType(blockType: BlockType): boolean {
  return BLOCK_TYPE_DEFINITIONS[blockType].contentKind === "text";
}
