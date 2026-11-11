// Sheets to start a design document from: the pieces a design document in a spreadsheet
// usually has, as Markdown and Mermaid blocks laid out on one sheet. Text in both display
// languages; the one shown in the app is used.

import type { DisplayLanguage } from "../../config/language-config";

export const DESIGN_TEMPLATE_IDS = [
  "screenDesign",
  "tableDefinition",
  "apiSpecification",
  "designReview",
] as const;
export type DesignTemplateId = (typeof DESIGN_TEMPLATE_IDS)[number];

export interface TemplateBlock {
  readonly blockType: "markdown" | "mermaid";
  // World units on the new sheet.
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: Readonly<Record<DisplayLanguage, string>>;
  readonly caption?: Readonly<Record<DisplayLanguage, string>>;
}

export interface DesignTemplate {
  readonly name: Readonly<Record<DisplayLanguage, string>>;
  readonly blocks: readonly TemplateBlock[];
}

const lines = (...parts: readonly string[]) => `${parts.join("\n")}\n`;

export const DESIGN_TEMPLATES: Readonly<
  Record<DesignTemplateId, DesignTemplate>
> = {
  screenDesign: {
    name: { ja: "画面設計書", en: "Screen Design" },
    blocks: [
      {
        blockType: "markdown",
        x: 0,
        y: 0,
        width: 520,
        height: 360,
        text: {
          ja: lines(
            "# 画面名",
            "",
            "| 項目 | 内容 |",
            "| ---- | ---- |",
            "| 画面ID | SCR-001 |",
            "| 目的 | この画面で利用者ができること |",
            "| 利用者 | 対象となる利用者・権限 |",
            "| 遷移元 | どの画面から来るか |",
          ),
          en: lines(
            "# Screen name",
            "",
            "| Item | Value |",
            "| ---- | ----- |",
            "| Screen ID | SCR-001 |",
            "| Purpose | What users can do here |",
            "| Users | Who uses it, with which rights |",
            "| Comes from | The screens that lead here |",
          ),
        },
      },
      {
        blockType: "markdown",
        x: 560,
        y: 0,
        width: 560,
        height: 360,
        text: {
          ja: lines(
            "## 画面項目",
            "",
            "| No | 項目名 | 種類 | 必須 | 入力チェック | 備考 |",
            "| -: | ------ | ---- | :--: | ------------ | ---- |",
            "| 1 | 氏名 | テキスト | ○ | 50文字以内 | |",
            "| 2 | メール | テキスト | ○ | メール形式 | |",
            "| 3 | 登録 | ボタン | | | 押すと確認画面へ |",
          ),
          en: lines(
            "## Fields",
            "",
            "| No | Field | Kind | Required | Validation | Notes |",
            "| -: | ----- | ---- | :------: | ---------- | ----- |",
            "| 1 | Name | Text | Yes | Up to 50 characters | |",
            "| 2 | Email | Text | Yes | Email address | |",
            "| 3 | Register | Button | | | Opens the confirmation |",
          ),
        },
      },
      {
        blockType: "mermaid",
        x: 0,
        y: 400,
        width: 520,
        height: 320,
        text: {
          ja: lines(
            "flowchart LR",
            "  list[一覧] --> input[入力]",
            "  input --> confirm{確認}",
            "  confirm -->|OK| done[完了]",
            "  confirm -->|戻る| input",
          ),
          en: lines(
            "flowchart LR",
            "  list[List] --> input[Input]",
            "  input --> confirm{Confirm}",
            "  confirm -->|OK| done[Done]",
            "  confirm -->|Back| input",
          ),
        },
        caption: { ja: "画面遷移", en: "Screen flow" },
      },
      {
        blockType: "markdown",
        x: 560,
        y: 400,
        width: 560,
        height: 320,
        text: {
          ja: lines(
            "## 画面イメージ",
            "",
            "画面のスクリーンショットやワイヤーフレームを、このシートにドラッグ & ドロップして並べてください。",
            "",
            "## 処理・メッセージ",
            "",
            "- 登録ボタン: 入力チェック後、確認画面を表示する",
            "- エラー時: 項目の下にメッセージを表示する",
          ),
          en: lines(
            "## Screen image",
            "",
            "Drop screenshots or wireframes onto this sheet and place them here.",
            "",
            "## Behaviour and messages",
            "",
            "- Register: validates the fields, then shows the confirmation",
            "- On an error: the message appears under the field",
          ),
        },
      },
    ],
  },
  tableDefinition: {
    name: { ja: "テーブル定義書", en: "Table Definition" },
    blocks: [
      {
        blockType: "markdown",
        x: 0,
        y: 0,
        width: 820,
        height: 360,
        text: {
          ja: lines(
            "# テーブル名（orders）",
            "",
            "| No | 論理名 | 物理名 | 型 | 桁 | NULL | キー | 既定値 | 備考 |",
            "| -: | ------ | ------ | -- | -: | :--: | :--: | ------ | ---- |",
            "| 1 | 注文ID | id | uuid | | × | PK | | |",
            "| 2 | 顧客ID | customer_id | uuid | | × | FK | | customers.id |",
            "| 3 | 合計金額 | total | integer | | × | | 0 | 税込・円 |",
            "| 4 | 作成日時 | created_at | timestamp | | × | | now() | |",
          ),
          en: lines(
            "# Table name (orders)",
            "",
            "| No | Name | Column | Type | Length | Null | Key | Default | Notes |",
            "| -: | ---- | ------ | ---- | -----: | :--: | :-: | ------- | ----- |",
            "| 1 | Order ID | id | uuid | | No | PK | | |",
            "| 2 | Customer ID | customer_id | uuid | | No | FK | | customers.id |",
            "| 3 | Total | total | integer | | No | | 0 | Tax included |",
            "| 4 | Created at | created_at | timestamp | | No | | now() | |",
          ),
        },
      },
      {
        blockType: "mermaid",
        x: 860,
        y: 0,
        width: 480,
        height: 360,
        text: {
          ja: lines(
            "erDiagram",
            "  CUSTOMERS ||--o{ ORDERS : places",
            "  ORDERS {",
            "    uuid id PK",
            "    uuid customer_id FK",
            "    integer total",
            "  }",
          ),
          en: lines(
            "erDiagram",
            "  CUSTOMERS ||--o{ ORDERS : places",
            "  ORDERS {",
            "    uuid id PK",
            "    uuid customer_id FK",
            "    integer total",
            "  }",
          ),
        },
        caption: { ja: "関連するテーブル", en: "Related tables" },
      },
      {
        blockType: "markdown",
        x: 0,
        y: 400,
        width: 820,
        height: 200,
        text: {
          ja: lines(
            "## インデックス",
            "",
            "| 名前 | 列 | 一意 |",
            "| ---- | -- | :--: |",
            "| orders_customer_id_idx | customer_id | |",
          ),
          en: lines(
            "## Indexes",
            "",
            "| Name | Columns | Unique |",
            "| ---- | ------- | :----: |",
            "| orders_customer_id_idx | customer_id | |",
          ),
        },
      },
    ],
  },
  apiSpecification: {
    name: { ja: "API仕様書", en: "API Specification" },
    blocks: [
      {
        blockType: "markdown",
        x: 0,
        y: 0,
        width: 600,
        height: 440,
        text: {
          ja: lines(
            "# POST /orders",
            "",
            "注文を登録する。",
            "",
            "## リクエスト",
            "",
            "| 名前 | 型 | 必須 | 説明 |",
            "| ---- | -- | :--: | ---- |",
            "| customerId | string | ○ | 顧客ID |",
            "| items | array | ○ | 商品と数量 |",
            "",
            "## レスポンス",
            "",
            "| ステータス | 内容 |",
            "| :--------: | ---- |",
            "| 201 | 登録した注文 |",
            "| 400 | 入力エラー |",
            "| 409 | 在庫不足 |",
          ),
          en: lines(
            "# POST /orders",
            "",
            "Places an order.",
            "",
            "## Request",
            "",
            "| Name | Type | Required | Description |",
            "| ---- | ---- | :------: | ----------- |",
            "| customerId | string | Yes | The customer |",
            "| items | array | Yes | Products and quantities |",
            "",
            "## Response",
            "",
            "| Status | Body |",
            "| :----: | ---- |",
            "| 201 | The new order |",
            "| 400 | Invalid input |",
            "| 409 | Out of stock |",
          ),
        },
      },
      {
        blockType: "mermaid",
        x: 640,
        y: 0,
        width: 520,
        height: 440,
        text: {
          ja: lines(
            "sequenceDiagram",
            "  participant C as クライアント",
            "  participant A as API",
            "  participant D as DB",
            "  C->>A: POST /orders",
            "  A->>D: 在庫を確認",
            "  D-->>A: 結果",
            "  A-->>C: 201 Created",
          ),
          en: lines(
            "sequenceDiagram",
            "  participant C as Client",
            "  participant A as API",
            "  participant D as DB",
            "  C->>A: POST /orders",
            "  A->>D: Check stock",
            "  D-->>A: Result",
            "  A-->>C: 201 Created",
          ),
        },
        caption: { ja: "処理の流れ", en: "Sequence" },
      },
    ],
  },
  designReview: {
    name: { ja: "設計レビュー", en: "Design Review" },
    blocks: [
      {
        blockType: "markdown",
        x: 0,
        y: 0,
        width: 560,
        height: 400,
        text: {
          ja: lines(
            "# 設計レビュー",
            "",
            "| 項目 | 内容 |",
            "| ---- | ---- |",
            "| 対象 | |",
            "| 日付 | |",
            "| 参加者 | |",
            "",
            "## 確認項目",
            "",
            "- [ ] 要件をすべて満たしている",
            "- [ ] エラー時の動きが決まっている",
            "- [ ] 性能・セキュリティの考慮がある",
            "- [ ] テストの方法が決まっている",
          ),
          en: lines(
            "# Design review",
            "",
            "| Item | Value |",
            "| ---- | ----- |",
            "| Subject | |",
            "| Date | |",
            "| Reviewers | |",
            "",
            "## Checklist",
            "",
            "- [ ] Every requirement is covered",
            "- [ ] Errors are handled",
            "- [ ] Performance and security are considered",
            "- [ ] The test approach is decided",
          ),
        },
      },
      {
        blockType: "markdown",
        x: 600,
        y: 0,
        width: 560,
        height: 400,
        text: {
          ja: lines(
            "## 指摘事項",
            "",
            "| No | 指摘 | 対応 | 担当 | 状態 |",
            "| -: | ---- | ---- | ---- | :--: |",
            "| 1 | | | | 未対応 |",
          ),
          en: lines(
            "## Findings",
            "",
            "| No | Finding | Action | Owner | Status |",
            "| -: | ------- | ------ | ----- | :----: |",
            "| 1 | | | | Open |",
          ),
        },
      },
    ],
  },
};
