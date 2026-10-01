import { type DomainResult, err, ok } from "../shared/domain-result";

// BlockType definition table. Add a row here to introduce a new block type; do not
// branch on identifiers elsewhere. File extensions and directories live in Rust only.
export const BLOCK_TYPE_DEFINITIONS = {
  markdown: { identifier: "markdown", contentKind: "text" },
  mermaid: { identifier: "mermaid", contentKind: "text" },
  image: { identifier: "image", contentKind: "asset" },
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
