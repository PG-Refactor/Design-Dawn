// User-visible strings of the custom templates, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const TEMPLATE_MESSAGES_JA = {
  saveAsTemplate: "テンプレートとして保存…",
  saveTitle: (kind: string): string => `${kind}をテンプレートとして保存`,
  nameLabel: "テンプレート名",
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
  fromTemplate: "テンプレートから追加",
  sheetFromTemplate: "テンプレートから作成",
  documentFromTemplate: "テンプレートから Document を作成",
  documentNameTitle: (template: string): string =>
    `テンプレート「${template}」から Document を作成`,
  documentNameLabel: "Document名",
  create: "作成",
  noTemplates: "テンプレートはありません",
  manage: "テンプレートの管理…",
  manageTitle: "テンプレートの管理",
  rename: "名前を変更",
  renameDone: "変更",
  moveTo: "移動先",
  delete: "削除",
  deleteConfirm: (name: string): string =>
    `テンプレート「${name}」を削除しますか？元に戻せません。`,
  close: "閉じる",
  emptyList:
    "まだテンプレートはありません。ブロック・シート・Document の右クリックから保存できます。",
  issues: (count: number): string =>
    `読み込めなかったテンプレートが ${count} 件あります。`,
} as const;

export type TemplateMessages = Widen<typeof TEMPLATE_MESSAGES_JA>;

const TEMPLATE_MESSAGES_EN: TemplateMessages = {
  saveAsTemplate: "Save as Template…",
  saveTitle: (kind) => `Save the ${kind} as a Template`,
  nameLabel: "Template name",
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
  fromTemplate: "Add from Template",
  sheetFromTemplate: "New from Template",
  documentFromTemplate: "New Document from Template",
  documentNameTitle: (template) => `New Document from “${template}”`,
  documentNameLabel: "Document name",
  create: "Create",
  noTemplates: "No templates",
  manage: "Manage Templates…",
  manageTitle: "Manage Templates",
  rename: "Rename",
  renameDone: "Rename",
  moveTo: "Move to",
  delete: "Delete",
  deleteConfirm: (name) =>
    `Delete the template “${name}”? This cannot be undone.`,
  close: "Close",
  emptyList:
    "No templates yet. Save one from the right-click menu of a block, a sheet or a Document.",
  issues: (count) =>
    count === 1
      ? "1 template could not be read."
      : `${count} templates could not be read.`,
};

export const TEMPLATE_MESSAGES: Readonly<
  Record<DisplayLanguage, TemplateMessages>
> = { ja: TEMPLATE_MESSAGES_JA, en: TEMPLATE_MESSAGES_EN };
