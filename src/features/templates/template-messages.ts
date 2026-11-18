// User-visible strings of the custom templates, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const TEMPLATE_MESSAGES_JA = {
  saveAsTemplate: "カスタムテンプレートとして保存…",
  saveTitle: (kind: string): string =>
    `${kind}をカスタムテンプレートとして保存`,
  nameLabel: "カスタムテンプレート名",
  scopeLegend: "保存先",
  scopes: {
    shared: "このプロジェクトで共有（Git で共有されます）",
    project: "自分用: このプロジェクトのみ",
    global: "自分用: すべてのプロジェクト",
  },
  scopeShort: {
    shared: "共有",
    project: "このプロジェクト（自分用）",
    global: "すべてのプロジェクト（自分用）",
  },
  kinds: {
    markdown: "Markdown",
    mermaid: "Mermaid",
    sheet: "シート",
    document: "Document",
  },
  save: "保存",
  cancel: "キャンセル",
  nameRequired: "名前を入力してください。",
  fromTemplate: "カスタムテンプレートから追加",
  sheetFromTemplate: "カスタムテンプレートからSheetを作成",
  documentFromTemplate: "カスタムテンプレートから Document を作成",
  documentNameTitle: (template: string): string =>
    `カスタムテンプレート「${template}」から Document を作成`,
  documentNameLabel: "Document名",
  sheetNameTitle: (template: string): string =>
    `カスタムテンプレート「${template}」から Sheet を作成`,
  sheetNameLabel: "Sheet名",
  create: "作成",
  noTemplates: "カスタムテンプレートはありません",
  manage: "カスタムテンプレートの管理…",
  manageTitle: "カスタムテンプレートの管理",
  edit: "編集",
  editRegion: "カスタムテンプレートの編集",
  editingBanner: (name: string, kind: string, scope: string): string =>
    `カスタムテンプレート「${name}」（${kind}・${scope}）を編集中`,
  saveTemplate: "テンプレートを保存",
  savingTemplate: "保存中…",
  savedTemplate: "保存しました",
  closeEditTitle: "カスタムテンプレートの編集を閉じる",
  closeEditQuestion:
    "テンプレートに保存していない変更があります。保存してから閉じますか？",
  saveAndClose: "保存して閉じる",
  closeWithoutSaving: "保存せずに閉じる",
  rename: "名前を変更",
  renameDone: "変更",
  moveTo: "移動先",
  delete: "削除",
  deleteConfirm: (name: string): string =>
    `カスタムテンプレート「${name}」を削除しますか？元に戻せません。`,
  close: "閉じる",
  emptyList:
    "まだカスタムテンプレートはありません。ブロック・シート・Document の右クリックから保存できます。",
  issues: (count: number): string =>
    `読み込めなかったカスタムテンプレートが ${count} 件あります。`,
} as const;

export type TemplateMessages = Widen<typeof TEMPLATE_MESSAGES_JA>;

const TEMPLATE_MESSAGES_EN: TemplateMessages = {
  saveAsTemplate: "Save as Custom Template…",
  saveTitle: (kind) => `Save the ${kind} as a Custom Template`,
  nameLabel: "Custom template name",
  scopeLegend: "Save in",
  scopes: {
    shared: "Shared in this Project (through Git)",
    project: "Mine: this Project only",
    global: "Mine: every Project",
  },
  scopeShort: {
    shared: "Shared",
    project: "This Project (mine)",
    global: "Every Project (mine)",
  },
  kinds: {
    markdown: "Markdown",
    mermaid: "Mermaid",
    sheet: "Sheet",
    document: "Document",
  },
  save: "Save",
  cancel: "Cancel",
  nameRequired: "Enter a name.",
  fromTemplate: "Add from Custom Template",
  sheetFromTemplate: "New Sheet from Custom Template",
  documentFromTemplate: "New Document from Custom Template",
  documentNameTitle: (template) =>
    `New Document from the custom template “${template}”`,
  documentNameLabel: "Document name",
  sheetNameTitle: (template) =>
    `New Sheet from the custom template “${template}”`,
  sheetNameLabel: "Sheet name",
  create: "Create",
  noTemplates: "No custom templates",
  manage: "Manage Custom Templates…",
  manageTitle: "Manage Custom Templates",
  edit: "Edit",
  editRegion: "Custom template editing",
  editingBanner: (name, kind, scope) =>
    `Editing the custom template “${name}” (${kind}, ${scope})`,
  saveTemplate: "Save Template",
  savingTemplate: "Saving…",
  savedTemplate: "Saved",
  closeEditTitle: "Close the Custom Template",
  closeEditQuestion:
    "The template has changes that are not saved. Save them before closing?",
  saveAndClose: "Save and Close",
  closeWithoutSaving: "Close Without Saving",
  rename: "Rename",
  renameDone: "Rename",
  moveTo: "Move to",
  delete: "Delete",
  deleteConfirm: (name) =>
    `Delete the custom template “${name}”? This cannot be undone.`,
  close: "Close",
  emptyList:
    "No custom templates yet. Save one from the right-click menu of a block, a sheet or a Document.",
  issues: (count) =>
    count === 1
      ? "1 custom template could not be read."
      : `${count} custom templates could not be read.`,
};

export const TEMPLATE_MESSAGES: Readonly<
  Record<DisplayLanguage, TemplateMessages>
> = { ja: TEMPLATE_MESSAGES_JA, en: TEMPLATE_MESSAGES_EN };
