// A diff of a file inside a Sheet shown as the Sheet looks at both versions, side by side:
// the earlier version on the left, the later on the right, panned and zoomed together, with
// what was added, removed, moved or changed marked, and the list of those Blocks above.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type BlockChange,
  compareSheetVersions,
} from "../../application/git/sheet-comparison";
import type { Viewport } from "../../application/local-state/viewport";
import type { GitSheetVersions } from "../../application/ports/git-gateway";
import type { OperationResult } from "../../application/ports/operation-error";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import type { Block } from "../../domain/block/block";
import {
  type BlockId,
  type DocumentId,
  parseDocumentId,
} from "../../domain/shared/entity-id";
import { GlyphIcon } from "../../shared/icons/glyph-icon";
import {
  clampViewport,
  panBy,
  zoomAt,
  zoomByWheel,
} from "../canvas/geometry/viewport-math";
import type { GitSelection } from "../workspace/ui-state/ui-state";
import { useMessages } from "../workspace/use-messages";
import { useGitState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { SheetSnapshot, type SnapshotSide } from "./sheet-snapshot";
import "./git-sheet-diff.css";

// Room left round the Blocks when the view is fitted, in screen pixels.
const FIT_MARGIN_PX = 24;
const FIT_MAX_ZOOM = 1;
// The − / + buttons: one step of the wheel's zoom each.
const BUTTON_ZOOM_FACTOR = 1.25;

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function boundsOf(blocks: readonly Block[]): Bounds | null {
  if (blocks.length === 0) return null;
  return blocks.reduce<Bounds>(
    (bounds, block) => ({
      left: Math.min(bounds.left, block.position.x),
      top: Math.min(bounds.top, block.position.y),
      right: Math.max(bounds.right, block.position.x + block.size.width),
      bottom: Math.max(bounds.bottom, block.position.y + block.size.height),
    }),
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );
}

// Everything in view (never larger than 100 %), or the given Blocks centred.
function fittedViewport(
  bounds: Bounds | null,
  pane: { readonly width: number; readonly height: number },
): Viewport {
  if (bounds === null || pane.width <= 0 || pane.height <= 0) {
    return clampViewport(CANVAS_CONFIG.viewport.default);
  }
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const zoom = Math.min(
    FIT_MAX_ZOOM,
    (pane.width - 2 * FIT_MARGIN_PX) / Math.max(width, 1),
    (pane.height - 2 * FIT_MARGIN_PX) / Math.max(height, 1),
  );
  return clampViewport({
    panX: (pane.width - width * zoom) / 2 - bounds.left * zoom,
    panY: (pane.height - height * zoom) / 2 - bounds.top * zoom,
    zoom,
  });
}

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "loaded"; readonly versions: GitSheetVersions };

export function GitSheetVisualDiff({
  selection,
}: {
  readonly selection: GitSelection;
}) {
  const messages = useMessages().git.sheetDiff;
  const { gitController } = useWorkspaceServices();
  // A new status (after a save, a stage, a refresh) may mean new versions.
  const status = useGitState((git) => git.status);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [focused, setFocused] = useState<BlockId | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: status is the trigger to read again.
  useEffect(() => {
    let current = true;
    void gitController
      .sheetVersions(selection.path, selection.side)
      .then((result: OperationResult<GitSheetVersions>) => {
        if (!current) return;
        setLoaded(
          result.ok
            ? { status: "loaded", versions: result.value }
            : { status: "failed" },
        );
      });
    return () => {
      current = false;
    };
  }, [gitController, selection.path, selection.side, status]);

  const versions = loaded.status === "loaded" ? loaded.versions : null;
  const comparison = useMemo(
    () =>
      versions === null
        ? null
        : compareSheetVersions(versions.before, versions.after),
    [versions],
  );
  const allBlocks = useMemo(
    () => [
      ...(versions?.before?.sheet?.blocks ?? []),
      ...(versions?.after?.sheet?.blocks ?? []),
    ],
    [versions],
  );

  function paneSize() {
    const pane = paneRef.current;
    return { width: pane?.clientWidth ?? 0, height: pane?.clientHeight ?? 0 };
  }
  function fitAll(): void {
    setViewport(fittedViewport(boundsOf(allBlocks), paneSize()));
  }
  // Fitted once the Sheet is there (and again for another file).
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitted when what is shown changes, not on every render.
  useEffect(() => {
    if (versions !== null) fitAll();
  }, [versions === null, selection.path, selection.side]);

  // The wheel pans both versions; with Ctrl it zooms at the pointer, as on the canvas.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the panes exist only once the versions are loaded, so the listener is added again then.
  useEffect(() => {
    const panes = panesRef.current;
    if (panes === null) return undefined;
    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      const box = (
        event.target instanceof Element
          ? event.target.closest(".sheet-snapshot__pane")
          : null
      )?.getBoundingClientRect();
      setViewport((current) => {
        if (current === null) return current;
        if (event.ctrlKey) {
          const point = {
            x: event.clientX - (box?.left ?? 0),
            y: event.clientY - (box?.top ?? 0),
          };
          return zoomByWheel(current, point, event.deltaY);
        }
        return panBy(current, { x: -event.deltaX, y: -event.deltaY });
      });
    }
    panes.addEventListener("wheel", onWheel, { passive: false });
    return () => panes.removeEventListener("wheel", onWheel);
  }, [versions]);

  function focus(change: BlockChange): void {
    setFocused(change.blockId);
    const block = allBlocks.find(
      (candidate) => candidate.blockId === change.blockId,
    );
    if (block === undefined) return;
    const pane = paneSize();
    setViewport((current) => {
      const zoom = current?.zoom ?? FIT_MAX_ZOOM;
      return clampViewport({
        panX: pane.width / 2 - (block.position.x + block.size.width / 2) * zoom,
        panY:
          pane.height / 2 - (block.position.y + block.size.height / 2) * zoom,
        zoom,
      });
    });
  }

  function zoomBy(factor: number): void {
    const pane = paneSize();
    setViewport((current) =>
      current === null
        ? current
        : zoomAt(
            current,
            { x: pane.width / 2, y: pane.height / 2 },
            current.zoom * factor,
          ),
    );
  }

  if (loaded.status === "loading") {
    return (
      <p role="status" aria-busy="true" className="git-diff__message">
        {messages.loading}
      </p>
    );
  }
  if (loaded.status === "failed" || versions === null || comparison === null) {
    return (
      <p role="status" className="git-diff__message">
        {messages.failed}
      </p>
    );
  }
  const documentId: DocumentId | null =
    versions.documentId === null
      ? null
      : (() => {
          const parsed = parseDocumentId(versions.documentId);
          return parsed.ok ? parsed.value : null;
        })();
  const changes = new Map(
    comparison.changes.map((change) => [change.blockId, change]),
  );
  const beforeById = new Map(
    (versions.before?.sheet?.blocks ?? []).map((block) => [
      block.blockId,
      block,
    ]),
  );
  // Where moved Blocks were, for the later version's dashed outlines.
  const earlierFrames = new Map(
    comparison.changes
      .filter((change) => change.moved || change.resized)
      .flatMap((change) => {
        const earlier = beforeById.get(change.blockId);
        return earlier === undefined
          ? []
          : [[change.blockId, earlier] as const];
      }),
  );
  const { counts } = comparison;
  const shown = viewport ?? clampViewport(CANVAS_CONFIG.viewport.default);

  function pane(side: SnapshotSide, label: string) {
    const version = side === "before" ? versions?.before : versions?.after;
    return (
      // biome-ignore lint/a11y/useSemanticElements: a labelled region over a div is intended.
      <div
        ref={side === "before" ? paneRef : undefined}
        role="region"
        aria-label={messages.paneLabel(label)}
        className="sheet-snapshot__pane"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start === null) return;
          drag.current = { x: event.clientX, y: event.clientY };
          setViewport((current) =>
            current === null
              ? current
              : panBy(current, {
                  x: event.clientX - start.x,
                  y: event.clientY - start.y,
                }),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <p className="sheet-snapshot__label">{label}</p>
        {version === null || version === undefined ? (
          <p className="sheet-snapshot__missing">{messages.missing}</p>
        ) : (
          <SheetSnapshot
            version={version}
            side={side}
            documentId={documentId}
            changes={changes}
            earlierFrames={earlierFrames}
            focused={focused}
            viewport={shown}
          />
        )}
      </div>
    );
  }

  return (
    <div className="sheet-diff">
      <div className="sheet-diff__toolbar">
        <p className="sheet-diff__summary" role="status">
          {comparison.changes.length === 0
            ? messages.noChange
            : messages.summary(
                counts.added,
                counts.removed,
                counts.moved,
                counts.changed,
              )}
        </p>
        <button
          type="button"
          className="git-icon-button"
          aria-label={messages.zoomOut}
          title={messages.zoomOut}
          onClick={() => zoomBy(1 / BUTTON_ZOOM_FACTOR)}
        >
          <GlyphIcon glyph="minus" />
        </button>
        <button
          type="button"
          className="git-icon-button"
          aria-label={messages.zoomIn}
          title={messages.zoomIn}
          onClick={() => zoomBy(BUTTON_ZOOM_FACTOR)}
        >
          <GlyphIcon glyph="plus" />
        </button>
        <button type="button" className="button" onClick={fitAll}>
          {messages.fit}
        </button>
      </div>
      {comparison.changes.length === 0 ? null : (
        <ul className="sheet-diff__list" aria-label={messages.listLabel}>
          {comparison.changes.map((change) => {
            const block =
              versions.after?.sheet?.blocks.find(
                (candidate) => candidate.blockId === change.blockId,
              ) ?? beforeById.get(change.blockId);
            const kinds = [
              change.kind === "added" ? messages.added : null,
              change.kind === "removed" ? messages.removed : null,
              change.moved || change.resized ? messages.moved : null,
              change.content || change.display || change.caption || change.order
                ? messages.changed
                : null,
            ].filter((kind) => kind !== null);
            return (
              <li key={change.blockId}>
                <button
                  type="button"
                  className="sheet-diff__item"
                  aria-pressed={focused === change.blockId}
                  onClick={() => focus(change)}
                >
                  <span className="sheet-diff__kinds">{kinds.join("・")}</span>{" "}
                  <span>
                    {block?.blockType ?? ""}{" "}
                    {change.blockId.slice(-CANVAS_CONFIG.block.shortIdLength)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div ref={panesRef} className="sheet-diff__panes">
        {pane("before", messages.before)}
        {pane("after", messages.after)}
      </div>
    </div>
  );
}
