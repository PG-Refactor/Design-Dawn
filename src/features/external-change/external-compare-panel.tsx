import type { GitDiff } from "../../application/ports/git-gateway";
import { GitDiffContent } from "../git/git-diff-content";
import { DiffViewToggle } from "../git/git-diff-view-toggle";
import { COMPARE_PANEL_ID, COMPARE_TAB_ID } from "../workspace/tab-ids";
import type { CompareTab } from "../workspace/ui-state/ui-state";
import { useMessages } from "../workspace/use-messages";
import { useUiState } from "../workspace/workspace-hooks";
import { ActiveDocumentBanner } from "./external-change-banner";
import { useExternalChangeState } from "./use-external-change";
import "./external-change.css";
import "../git/git-panel.css";

const selectCompareTab = (ui: { readonly compareTab: CompareTab | null }) =>
  ui.compareTab;

// The diff of a comparison is shown by the Git diff view's own body (hunks, side by side or
// inline), as a diff of the disk (old, left) against the memory (new, right).
function ComparisonBody({ tab }: { readonly tab: CompareTab }) {
  const texts = useMessages().workspace.externalChange;
  const { content } = tab;
  if (content.status === "loading") {
    return (
      <p role="status" aria-busy="true" className="git-diff__message">
        {texts.compareLoading}
      </p>
    );
  }
  if (content.status === "unavailable") {
    return <p className="git-diff__message">{texts.compareUnavailable}</p>;
  }
  const { comparison } = content;
  switch (comparison.outcome) {
    case "text": {
      const diff: GitDiff = {
        path: tab.path,
        side: "unstaged",
        outcome: "text",
        diff: comparison.diff,
      };
      return <GitDiffContent diff={diff} />;
    }
    case "identical":
      return <p className="git-diff__message">{texts.compareIdentical}</p>;
    case "removedOnDisk":
      return <p className="git-diff__message">{texts.compareRemovedOnDisk}</p>;
    case "notUtf8":
      return <p className="git-diff__message">{texts.compareNotUtf8}</p>;
    case "tooLarge":
      return <p className="git-diff__message">{texts.compareTooLarge}</p>;
  }
}

// The tab panel of the compare tab: what was compared, the notice that drafts are not part
// of it, the diff, and (while the Document's conflict is open) the way to decide.
export function ExternalComparePanel() {
  const texts = useMessages().workspace.externalChange;
  const tab = useUiState(selectCompareTab);
  const state = useExternalChangeState();
  if (tab === null) return null;
  const open = state.conflicts.some(
    (entry) => entry.documentId === tab.documentId,
  );
  const hasText =
    tab.content.status === "loaded" &&
    tab.content.comparison.outcome === "text";
  return (
    <section
      role="tabpanel"
      id={COMPARE_PANEL_ID}
      aria-labelledby={COMPARE_TAB_ID}
      className="git-main-area"
    >
      <div className="git-diff">
        <header className="git-diff__header">
          <h2 className="git-diff__path">{texts.compareHeading(tab.path)}</h2>
          {hasText ? <DiffViewToggle /> : null}
        </header>
        <p className="external-change__compare-note">
          {texts.compareLegend}. {texts.compareDraftNotice}
        </p>
        {open ? (
          <ActiveDocumentBanner documentId={tab.documentId} always />
        ) : null}
        <div className="git-diff__body">
          <ComparisonBody tab={tab} />
        </div>
      </div>
    </section>
  );
}
