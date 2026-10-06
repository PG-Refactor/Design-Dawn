import { type CSSProperties, useRef, useState } from "react";
import type { LayoutSettingsState } from "../../application/settings/layout-settings-controller";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { DocumentPanel } from "./document-panel";
import { DocumentTabs } from "./document-tabs";
import { ProjectTree } from "./project-tree";
import { ProjectTreeSplitter } from "./project-tree-splitter";
import { MESSAGES } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";

const { defaultWidthPx, maxWidthPx } = LAYOUT_CONFIG.projectTree;
const { documentAreaMinWidthPx, splitterWidthPx } = LAYOUT_CONFIG;

// The CSS reads the widths from custom properties so the numbers live in the config only.
type LayoutStyle = CSSProperties & Record<`--${string}`, string>;

const selectProjectTreeWidth = (state: LayoutSettingsState) =>
  state.projectTreeWidth;

// Project Tree, the splitter and the document area. The stored width comes from the layout
// settings; while the user drags, a local live width is shown and stored only at the end.
export function WorkspaceBody() {
  const { layoutSettingsController } = useWorkspaceServices();
  const storedWidth = useStoreSelector(
    layoutSettingsController.store,
    selectProjectTreeWidth,
  );
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Only the newest save may clear the live width: an older, slower one finishing later
  // would otherwise snap the panel back while a newer change is still being stored.
  const latestRequestRef = useRef(0);
  const pendingSavesRef = useRef(0);
  const width = liveWidth ?? storedWidth;

  // The stored width is not changed until the save succeeds, so after a failure the
  // panel returns to the previous width; the error is shown as a notification.
  async function commit(next: number) {
    if (next === storedWidth && pendingSavesRef.current === 0) {
      // Nothing to store (a click on the splitter, or a drag back to where it started).
      setLiveWidth(null);
      return;
    }
    latestRequestRef.current += 1;
    pendingSavesRef.current += 1;
    const request = latestRequestRef.current;
    setLiveWidth(next);
    try {
      await layoutSettingsController.setProjectTreeWidth(next);
    } finally {
      pendingSavesRef.current -= 1;
      if (request === latestRequestRef.current) setLiveWidth(null);
    }
  }

  function measureMaxWidth(): number {
    const containerWidth = bodyRef.current?.getBoundingClientRect().width ?? 0;
    // An unmeasurable container (not laid out) must not collapse the limit to zero.
    if (containerWidth <= 0) return maxWidthPx;
    return Math.min(
      maxWidthPx,
      containerWidth - documentAreaMinWidthPx - splitterWidthPx,
    );
  }

  const style: LayoutStyle = {
    "--project-tree-width": `${width}px`,
    "--document-area-min-width": `${documentAreaMinWidthPx}px`,
    "--splitter-width": `${splitterWidthPx}px`,
  };

  return (
    <div ref={bodyRef} className="workspace-shell__body" style={style}>
      <aside
        className="workspace-shell__sidebar"
        aria-label={MESSAGES.appRegionTreeLabel}
      >
        <ProjectTree />
      </aside>
      <ProjectTreeSplitter
        width={width}
        measureMaxWidth={measureMaxWidth}
        onPreview={setLiveWidth}
        onCommit={(next) => void commit(next)}
        onCancel={() => setLiveWidth(null)}
        onReset={() => void commit(Math.min(defaultWidthPx, measureMaxWidth()))}
      />
      <main className="workspace-shell__main">
        <DocumentTabs />
        <DocumentPanel />
      </main>
    </div>
  );
}
