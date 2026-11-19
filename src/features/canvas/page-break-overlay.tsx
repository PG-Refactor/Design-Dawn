import type { CSSProperties } from "react";
import { PRINT_CONFIG } from "../../config/print-config";
import type { Block } from "../../domain/block/block";
import { BLOCK_TYPE_DEFINITIONS } from "../../domain/block/block-type";
import { drawnPictureRect } from "../../domain/print/page-layout";
import { PAPER_SIZES, paperLayout } from "../../domain/print/paper";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import type { PrintSettings } from "../export/print-settings";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { BLOCK_ID_ATTRIBUTE } from "./block-dom";

const selectSettings = (settings: PrintSettings) => settings;

// The paper pages of the sheet as the print would cut it (View > Show Page Breaks), with
// the paper chosen last in the print dialog: dashed outlines and page numbers in the world
// layer, behind the blocks. Lines and labels keep their screen size at every zoom.
// The own size of the picture the canvas shows for a block (an image's file, a diagram's
// SVG), or null before it is drawn.
function shownPictureSize(
  blockId: string,
): { readonly width: number; readonly height: number } | null {
  const picture = document.querySelector(
    `[${BLOCK_ID_ATTRIBUTE}="${CSS.escape(blockId)}"] img`,
  );
  if (!(picture instanceof HTMLImageElement)) return null;
  const { naturalWidth: width, naturalHeight: height } = picture;
  return width > 0 && height > 0 ? { width, height } : null;
}

export function PageBreakOverlay({
  blocks,
  zoom,
}: {
  readonly blocks: readonly Block[];
  readonly zoom: number;
}) {
  const { exportActions } = useWorkspaceServices();
  const messages = useMessages().export;
  const settings = useStoreSelector(
    exportActions.printSettings,
    selectSettings,
  );
  if (!settings.showPageBreaks) return null;
  const layout = paperLayout(
    blocks.map((block) => {
      const rect = {
        x: block.position.x,
        y: block.position.y,
        width: block.size.width,
        height: block.size.height,
      };
      // Diagrams and images: what prints as a picture (see figureSliverFraction). Where
      // the picture is drawn comes from the one the canvas shows, as printing finds it.
      const figure =
        block.blockType !== BLOCK_TYPE_DEFINITIONS.markdown.identifier;
      const natural =
        figure && block.caption === undefined
          ? shownPictureSize(block.blockId)
          : null;
      return {
        ...rect,
        figure,
        ...(natural === null ? {} : { drawn: drawnPictureRect(rect, natural) }),
      };
    }),
    settings.paper,
    PRINT_CONFIG.sheetMargin,
    PRINT_CONFIG.paperHeadingHeight,
    PRINT_CONFIG.figureSliverFraction,
  );
  if (layout === null) return null;
  const { paper } = settings;
  const scaleLabel = {
    actual: messages.scaleActual,
    fitWidth: messages.scaleFitWidth,
    fitPage: messages.scaleFitPage,
  }[paper.scale];
  const paperLabel = `${PAPER_SIZES[paper.size].name} ${
    paper.orientation === "portrait" ? messages.portrait : messages.landscape
  } · ${scaleLabel}`;
  return (
    <div
      aria-hidden="true"
      className="canvas__page-breaks"
      style={{ "--page-break-scale": 1 / zoom } as CSSProperties}
    >
      {layout.pages.map((page, index) => (
        <div
          key={`${page.x},${page.y}`}
          className="canvas__page"
          style={{
            left: page.x,
            top: page.y,
            width: page.width,
            height: page.height,
          }}
        >
          <span className="canvas__page-number">
            {index === 0 ? `${index + 1} · ${paperLabel}` : index + 1}
          </span>
        </div>
      ))}
    </div>
  );
}
