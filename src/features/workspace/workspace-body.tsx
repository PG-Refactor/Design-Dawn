import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import type { LayoutSettingsState } from "../../application/settings/layout-settings-controller";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import { GlyphIcon } from "../../shared/icons/glyph-icon";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { ExternalComparePanel } from "../external-change/external-compare-panel";
import { GitDiffPanel } from "../git/git-diff-panel";
import { DocumentPanel } from "./document-panel";
import { DocumentTabs } from "./document-tabs";
import { ProjectTreeSplitter } from "./project-tree-splitter";
import { Sidebar } from "./sidebar";
import { useMessages } from "./use-messages";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import { useWorkspaceServices } from "./workspace-services-context";

const { defaultWidthPx, maxWidthPx, minWidthPx } = LAYOUT_CONFIG.projectTree;
const { documentAreaMinWidthPx, splitterWidthPx } = LAYOUT_CONFIG;

// The CSS reads the widths from custom properties so the numbers live in the config only.
const SIDEBAR_SELECTOR = ".workspace-shell__sidebar";
const LEFT_PANEL_TABS_SELECTOR = ".left-panel-tabs";
// A panel header whose items must all show in full (the Git tab's: title, branch, buttons).
const FULL_HEADER_SELECTOR = ".git-panel__header";
// Text in such a header that may be cut with an ellipsis (it is measured in full).
const CUT_TEXT_SELECTOR = ".git-branch__name";
const identity = <T,>(value: T): T => value;

type LayoutStyle = CSSProperties & Record<`--${string}`, string>;

const selectProjectTreeWidth = (state: LayoutSettingsState) =>
  state.projectTreeWidth;

// Project Tree, the splitter and the document area. The stored width comes from the layout
// settings; while the user drags, a local live width is shown and stored only at the end.
export function WorkspaceBody() {
  const messages = useMessages().workspace;
  const {
    layoutSettingsController,
    actions,
    templateEditor,
    textSizeController,
    languageController,
  } = useWorkspaceServices();
  // A window that edits a Custom Template shows the template alone: no tree.
  const editingTemplate = useStoreSelector(
    templateEditor.store,
    (state) => state.editing !== null,
  );
  const storedWidth = useStoreSelector(
    layoutSettingsController.store,
    selectProjectTreeWidth,
  );
  const mainTabKind = useUiState((ui) => ui.activeMainTab.kind);
  const documentsOnly =
    useWorkspaceModel((application) => application.windowRole === "document") ||
    editingTemplate;
  const sidebarCollapsed = useUiState((ui) => ui.sidebarCollapsed);
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

  // The widest the Git header was found to need (it exists only while its tab is shown):
  // kept, so the panel does not narrow again when another tab is chosen. Forgotten when the
  // text size or language changes.
  const fullHeaderNeedRef = useRef(0);

  // What the panel needs so that nothing in its headers is hidden or overlapping: the Project
  // / Search / Git tabs and the fold button without scrolling, and every item of the Git
  // header (its title, the whole branch name, its buttons). The panel's width, less the room
  // each has, plus what its contents take. Not less than the configured minimum.
  function measureMinWidth(): number {
    const sidebar =
      bodyRef.current?.querySelector<HTMLElement>(SIDEBAR_SELECTOR);
    if (sidebar === null || sidebar === undefined) return minWidthPx;
    const sidebarWidth = sidebar.getBoundingClientRect().width;
    const tabs = sidebar.querySelector<HTMLElement>(LEFT_PANEL_TABS_SELECTOR);
    const first = tabs?.firstElementChild;
    const last = tabs?.lastElementChild;
    let needed: number = minWidthPx;
    if (
      tabs !== null &&
      first instanceof HTMLElement &&
      last instanceof HTMLElement
    ) {
      const tabsWidth =
        last.getBoundingClientRect().right - first.getBoundingClientRect().left;
      needed = Math.max(
        needed,
        sidebarWidth - tabs.getBoundingClientRect().width + tabsWidth,
      );
    }
    const header = sidebar.querySelector<HTMLElement>(FULL_HEADER_SELECTOR);
    if (header !== null) {
      fullHeaderNeedRef.current = Math.max(
        fullHeaderNeedRef.current,
        sidebarWidth -
          header.getBoundingClientRect().width +
          contentWidth(header),
      );
    }
    return Math.max(
      minWidthPx,
      Math.ceil(Math.max(needed, fullHeaderNeedRef.current)),
    );
  }

  // The header needs more room with larger text or another language: a narrower stored
  // width is shown at that size (and not stored until the user moves the splitter).
  const textSize = useStoreSelector(textSizeController.store, identity);
  const language = useStoreSelector(languageController.store, identity);
  const [headerMinWidth, setHeaderMinWidth] = useState<number>(minWidthPx);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when what decides the headers' width changes.
  useLayoutEffect(() => {
    fullHeaderNeedRef.current = 0;
  }, [textSize, language]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when what decides the headers' width changes.
  useLayoutEffect(() => {
    if (sidebarCollapsed || documentsOnly) return;
    setHeaderMinWidth(measureMinWidth());
    const sidebar = bodyRef.current?.querySelector(SIDEBAR_SELECTOR);
    if (sidebar === null || sidebar === undefined) return;
    // The Git header appears with its tab, and the branch name changes with git: measured
    // again then (once per frame at most).
    let frame: number | null = null;
    const observer = new MutationObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setHeaderMinWidth(measureMinWidth());
      });
    });
    observer.observe(sidebar, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [textSize, language, sidebarCollapsed, documentsOnly]);
  const shownWidth = Math.max(width, headerMinWidth);

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
    "--project-tree-width": `${shownWidth}px`,
    "--document-area-min-width": `${documentAreaMinWidthPx}px`,
    "--splitter-width": `${splitterWidthPx}px`,
  };

  return (
    <div
      ref={bodyRef}
      className={
        documentsOnly
          ? "workspace-shell__body workspace-shell__body--documents-only"
          : sidebarCollapsed
            ? "workspace-shell__body workspace-shell__body--sidebar-collapsed"
            : "workspace-shell__body"
      }
      style={style}
    >
      {/* A window of Documents moved out of another one has no tree: the Project window
          is where the tree is changed. */}
      {documentsOnly ? null : sidebarCollapsed ? (
        // Folded away: only a narrow strip with the button that brings it back.
        <div className="workspace-shell__sidebar-rail">
          <button
            type="button"
            className="icon-button"
            aria-label={messages.leftPanel.expandSidebar}
            title={messages.leftPanel.expandSidebar}
            onClick={() => actions.setSidebarCollapsed(false)}
          >
            <GlyphIcon glyph="doubleChevronRight" />
          </button>
        </div>
      ) : (
        <>
          <aside
            className="workspace-shell__sidebar"
            aria-label={messages.appRegionTreeLabel}
          >
            <Sidebar />
          </aside>
          <ProjectTreeSplitter
            width={shownWidth}
            measureMaxWidth={measureMaxWidth}
            measureMinWidth={measureMinWidth}
            onPreview={setLiveWidth}
            onCommit={(next) => void commit(next)}
            onCancel={() => setLiveWidth(null)}
            onReset={() =>
              void commit(Math.min(defaultWidthPx, measureMaxWidth()))
            }
          />
        </>
      )}
      <main className="workspace-shell__main">
        <DocumentTabs />
        {mainTabKind === "diff" ? <GitDiffPanel /> : null}
        {mainTabKind === "compare" ? <ExternalComparePanel /> : null}
        {mainTabKind === "document" ? <DocumentPanel /> : null}
      </main>
    </div>
  );
}

// The width a flex row's items take side by side at their full size: their widths, the text
// cut with an ellipsis at its full length, the gaps between them and the row's padding.
function contentWidth(row: HTMLElement): number {
  const style = getComputedStyle(row);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0);
  const items = [...row.children].filter(
    (item): item is HTMLElement => item instanceof HTMLElement,
  );
  let width = padding + gap * Math.max(0, items.length - 1);
  for (const item of items) {
    width += item.getBoundingClientRect().width;
    for (const cut of item.querySelectorAll<HTMLElement>(CUT_TEXT_SELECTOR)) {
      width += Math.max(0, cut.scrollWidth - cut.clientWidth);
    }
    if (item.matches(CUT_TEXT_SELECTOR)) {
      width += Math.max(0, item.scrollWidth - item.clientWidth);
    }
  }
  return width;
}
