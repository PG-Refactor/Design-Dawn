// The visible items of the change list as one flat tree, section headers (level 1) and their
// file rows (level 2), in display order. Pure, so the keyboard map can be tested without a DOM.

import type { FlatTreeItem } from "../workspace/view-models/keyboard-navigation";
import type {
  GitChangeEntry,
  GitChangeSection,
  GitChangeSectionId,
} from "./git-change-sections";

const SECTION_KEY_PREFIX = "section:";

export function sectionKeyOf(sectionId: GitChangeSectionId): string {
  return `${SECTION_KEY_PREFIX}${sectionId}`;
}

export type GitTreeItem =
  | {
      readonly kind: "section";
      readonly key: string;
      readonly section: GitChangeSection;
      readonly expanded: boolean;
    }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly entry: GitChangeEntry;
    };

// The items of the expanded sections follow their header; a collapsed section shows only
// its header.
export function buildGitTreeItems(
  sections: readonly GitChangeSection[],
  collapsed: ReadonlySet<GitChangeSectionId>,
): readonly GitTreeItem[] {
  return sections.flatMap((section): GitTreeItem[] => {
    const expanded = !collapsed.has(section.id);
    const header: GitTreeItem = {
      kind: "section",
      key: sectionKeyOf(section.id),
      section,
      expanded,
    };
    if (!expanded) return [header];
    return [
      header,
      ...section.entries.map(
        (entry): GitTreeItem => ({ kind: "file", key: entry.key, entry }),
      ),
    ];
  });
}

// The shape `treeNavigation` works on: headers are the "folders", files their children.
export function toFlatTreeItems(
  items: readonly GitTreeItem[],
): readonly FlatTreeItem[] {
  let parentIndex = -1;
  return items.map((item, index): FlatTreeItem => {
    if (item.kind === "section") {
      parentIndex = index;
      const next = items[index + 1];
      return {
        key: item.key,
        parentIndex: null,
        firstChildIndex:
          item.expanded && next?.kind === "file" ? index + 1 : null,
        opensOnExpand: false,
        folderState: item.expanded ? "expanded" : "collapsed",
      };
    }
    return {
      key: item.key,
      parentIndex,
      firstChildIndex: null,
      opensOnExpand: false,
      folderState: null,
    };
  });
}
