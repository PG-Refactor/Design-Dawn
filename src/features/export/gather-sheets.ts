// The blocks of sheets ready for an export page: Markdown rendered and sanitised like the
// app shows it, diagrams rendered again in the light theme, and every picture turned into
// a `data:` URL so the page needs no other file.

import type { AssetUrlResolver } from "../../application/ports/asset-url-resolver";
import type { OperationResult } from "../../application/ports/operation-error";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { Block } from "../../domain/block/block";
import { BLOCK_TYPE_DEFINITIONS } from "../../domain/block/block-type";
import { DEFAULT_CAPTION_POSITION } from "../../domain/block/caption";
import { parseContentPath } from "../../domain/block/content-path";
import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { CanvasActions } from "../canvas/canvas-actions";
import { renderMarkdown } from "../markdown/render-markdown";
import type { MermaidRenderer } from "../mermaid/mermaid-renderer-types";
import { renderDiagramForExport, svgFileText } from "./diagram-export";
import type { ExportBlock, ExportSheet } from "./export-html";

export interface GatherDependencies {
  readonly gateway: Pick<PersistenceGateway, "assetDataUrl">;
  readonly applicationStore: ApplicationStore;
  readonly canvasActions: Pick<CanvasActions, "loadSheetContents">;
  readonly assetUrlResolver: AssetUrlResolver;
  readonly renderer: MermaidRenderer;
}

const SOURCE_ATTRIBUTE_PATTERN = /src="([^"]+)"/g;
const SVG_DATA_PREFIX = "data:image/svg+xml;base64,";

function base64OfText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// The asset URLs inside rendered Markdown replaced with data URLs. A picture that cannot be
// read is removed from the page rather than left pointing at the app.
async function inlineImages(
  html: string,
  prefix: string,
  dataUrlOf: (url: string) => Promise<string | null>,
): Promise<string> {
  const urls = new Set(
    [...html.matchAll(SOURCE_ATTRIBUTE_PATTERN)]
      .map((match) => match[1] ?? "")
      .filter((url) => url.startsWith(prefix)),
  );
  let result = html;
  for (const url of urls) {
    const dataUrl = await dataUrlOf(url);
    result = result.split(`src="${url}"`).join(`src="${dataUrl ?? ""}"`);
  }
  return result;
}

async function exportBlock(
  dependencies: GatherDependencies,
  location: { readonly projectId: ProjectId; readonly documentId: DocumentId },
  block: Block,
  text: string | undefined,
): Promise<ExportBlock | null> {
  const { gateway, assetUrlResolver, renderer } = dependencies;
  const { projectId, documentId } = location;
  const rect = {
    x: block.position.x,
    y: block.position.y,
    width: block.size.width,
    height: block.size.height,
  };
  const caption =
    block.caption === undefined
      ? undefined
      : {
          text: block.caption,
          position: block.captionPosition ?? DEFAULT_CAPTION_POSITION,
        };
  const withCaption = (
    content: ExportBlock["content"],
    natural?: { readonly width: number; readonly height: number },
  ): ExportBlock => ({
    rect,
    content,
    ...(caption === undefined ? {} : { caption }),
    ...(natural === undefined ? {} : { natural }),
  });
  switch (block.blockType) {
    case BLOCK_TYPE_DEFINITIONS.markdown.identifier: {
      if (text === undefined) return null;
      const prefix = assetUrlResolver.documentUrlPrefix(projectId, documentId);
      // The asset URL carries the Document-relative path after the prefix.
      const html = renderMarkdown(text, {
        markdownContentPath: block.contentPath,
        urlFor: (assetPath) =>
          assetUrlResolver.urlFor(projectId, documentId, assetPath),
        urlPrefix: prefix,
      });
      const inlined = await inlineImages(html, prefix, async (url) => {
        const path = parseContentPath(
          decodeURIComponent(url.slice(prefix.length)),
        );
        if (!path.ok) return null;
        const read = await gateway.assetDataUrl(
          projectId,
          documentId,
          path.value,
        );
        return read.ok ? read.value : null;
      });
      return withCaption({ kind: "html", html: inlined });
    }
    case BLOCK_TYPE_DEFINITIONS.mermaid.identifier: {
      if (text === undefined) return null;
      const rendered = await renderDiagramForExport(renderer, text);
      const file = rendered.ok ? svgFileText(rendered.svg) : null;
      if (file === null) return null;
      return withCaption(
        {
          kind: "image",
          src: `${SVG_DATA_PREFIX}${base64OfText(file.text)}`,
          alt: block.caption ?? "",
        },
        { width: file.width, height: file.height },
      );
    }
    case BLOCK_TYPE_DEFINITIONS.image.identifier: {
      const read = await gateway.assetDataUrl(
        projectId,
        documentId,
        block.contentPath,
      );
      if (!read.ok) return null;
      return withCaption(
        {
          kind: "image",
          src: read.value,
          alt: block.caption ?? "",
        },
        await naturalSizeOf(read.value),
      );
    }
  }
}

// The sheets in the given order, each with its blocks back to front. A block whose
// content cannot be read or drawn is left out.
export async function gatherSheets(
  dependencies: GatherDependencies,
  documentId: DocumentId,
  sheetIds: readonly SheetId[],
): Promise<OperationResult<ExportSheet[]>> {
  const projectId =
    dependencies.applicationStore.getState().project?.projectId ?? null;
  if (projectId === null) {
    return operationErr("projectNotOpen", "no project is open");
  }
  const sheets: ExportSheet[] = [];
  for (const sheetId of sheetIds) {
    const loaded = await dependencies.canvasActions.loadSheetContents({
      documentId,
      sheetId,
    });
    if (!loaded.ok) return loaded;
    const document = dependencies.applicationStore
      .getState()
      .documents.get(documentId);
    const sheet = document?.sheets.get(sheetId);
    if (document === undefined || sheet === undefined) continue;
    const blocks: ExportBlock[] = [];
    for (const block of sheet.blocks) {
      const exported = await exportBlock(
        dependencies,
        { projectId, documentId },
        block,
        document.contents.get(block.blockId),
      );
      if (exported !== null) blocks.push(exported);
    }
    sheets.push({ name: sheet.name, blocks });
  }
  return operationOk(sheets);
}

// The size of an image (a data URL), or undefined where it cannot be decoded here (then
// the whole block counts as drawn when pages are cut).
async function naturalSizeOf(
  dataUrl: string,
): Promise<{ readonly width: number; readonly height: number } | undefined> {
  if (typeof createImageBitmap !== "function") return undefined;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return undefined;
  }
}
