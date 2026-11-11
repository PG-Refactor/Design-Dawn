import type { CSSProperties } from "react";
import { PRINT_CONFIG } from "../../config/print-config";
import type { Block } from "../../domain/block/block";
import { PAPER_SIZES, paperLayout } from "../../domain/print/paper";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import type { PrintSettings } from "../export/print-settings";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";

const selectSettings = (settings: PrintSettings) => settings;

// The paper pages of the sheet as the print would cut it (View > Show Page Breaks), with
// the paper chosen last in the print dialog: dashed outlines and page numbers in the world
// layer, behind the blocks. Lines and labels keep their screen size at every zoom.
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
    blocks.map((block) => ({
      x: block.position.x,
      y: block.position.y,
      width: block.size.width,
      height: block.size.height,
    })),
    settings.paper,
    PRINT_CONFIG.sheetMargin,
    PRINT_CONFIG.paperHeadingHeight,
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
