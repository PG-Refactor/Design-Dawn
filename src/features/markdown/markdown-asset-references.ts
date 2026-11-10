import type { TextAssetReferences } from "../../application/clipboard/copy-paste";
import { BLOCK_TYPE_DEFINITIONS } from "../../domain/block/block-type";
import type { ContentPath } from "../../domain/block/content-path";
import {
  markdownImageDestination,
  resolveMarkdownImagePath,
} from "../../domain/block/markdown-image-path";
import { markdownImageAssets } from "./render-markdown";

// The `](destination` part of a Markdown link or image: an `<...>` destination or one
// without spaces. The capture is replaced as a whole.
const DESTINATION_PATTERN = /\]\(\s*(<[^>\n]*>|[^\s)]+)/g;
const ANGLE_BRACKETS = /^<(.*)>$/;

function unwrapDestination(written: string): string {
  return written.replace(ANGLE_BRACKETS, "$1");
}

// What a pasted Markdown block refers to. Only Markdown blocks with a known source file
// have references: relative paths mean nothing without it.
export const markdownAssetReferences: TextAssetReferences = {
  find(block) {
    if (
      block.blockType !== BLOCK_TYPE_DEFINITIONS.markdown.identifier ||
      block.sourceContentPath === undefined
    ) {
      return [];
    }
    return markdownImageAssets(block.text, block.sourceContentPath);
  },

  // Rewrites every destination that resolves to a renamed asset. It works on the text, not
  // on parsed tokens (they carry no positions), so the same destination written inside a
  // code block is rewritten too; that only happens when a copy had to be renamed.
  rewrite(block, renamed) {
    const sourcePath = block.sourceContentPath;
    if (sourcePath === undefined) return block.text;
    return block.text.replace(
      DESTINATION_PATTERN,
      (match: string, written: string) => {
        const resolved = resolveMarkdownImagePath(
          sourcePath,
          unwrapDestination(written),
        );
        const target: ContentPath | undefined =
          resolved === null ? undefined : renamed.get(resolved);
        if (target === undefined) return match;
        return match.replace(
          written,
          markdownImageDestination(sourcePath, target),
        );
      },
    );
  },
};
