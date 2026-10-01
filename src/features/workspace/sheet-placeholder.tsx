import { sheetPanelId, sheetTabId } from "./tab-ids";
import { selectSheetTabs } from "./view-models/tabs-model";
import { useWorkspaceModel } from "./workspace-hooks";
import {
  activeDocumentText,
  activeSheetText,
  MESSAGES,
} from "./workspace-messages";
import "./sheet-placeholder.css";

// Stands in for the Infinite Canvas until it exists (docs/ui-design.md §3): shows which
// document and sheet are active. It is the tab panel of the active sheet tab.
export function SheetPlaceholder() {
  const model = useWorkspaceModel(selectSheetTabs);
  if (model === null) return null;
  const activeTab = model.tabs.find((tab) => tab.isActive);
  return (
    <div
      role="tabpanel"
      id={sheetPanelId(model.documentId)}
      className="sheet-placeholder"
      {...(activeTab === undefined
        ? { "aria-label": MESSAGES.tabs.sheetPanelLabel }
        : { "aria-labelledby": sheetTabId(activeTab.sheetId) })}
    >
      <p className="sheet-placeholder__line">
        {activeDocumentText(model.documentName)}
      </p>
      <p className="sheet-placeholder__line">
        {activeSheetText(activeTab?.name ?? MESSAGES.placeholder.none)}
      </p>
    </div>
  );
}
