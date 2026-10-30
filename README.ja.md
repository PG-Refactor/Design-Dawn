# Design Dawn

[English](README.md) | **日本語**

Design Dawn は、無限キャンバスの上で設計ドキュメントを書くためのデスクトップアプリケーションです。
ドキュメントは複数のシートからなり、各シートに **Markdown**・**Mermaid の図**・**画像** のブロックを自由に配置できます。
すべてが通常のファイルとフォルダとして保存されるため、人が読み書きでき、Git でレビューでき、AI ツールも安全に変更できます。

![Markdown と Mermaid のフローチャートを置いた設計ドキュメント](docs/images/overview-dark.png)

> **状態**: 公開前の開発版です。Linux（WSL2 + WSLg）で開発・確認しています。Windows・macOS 向けのビルドはまだ確認していません。
> 現在の状況は [`docs/development-state.md`](docs/development-state.md) を参照してください。

## 機能

- **無限キャンバス** — パン・ズーム・選択・移動・リサイズ・整列・重なり順・コピー / 貼り付け。すべての編集を元に戻せます（Undo / Redo）。
- **Project → Document → Sheet → Block** — フォルダつきの Project ツリー、Document タブ、Sheet タブ。複数の Document（と複数のウィンドウ）を同時に開けます。
- **Markdown ブロック** — キャンバス上では表示結果、編集中はソースとプレビューの分割表示。
- **Mermaid ブロック** — Mermaid 12 のすべての図を、ローカルで描画・サニタイズして表示します（ネットワーク・スクリプトなし）。
- **Mermaid の GUI 編集** — 円グラフ・フローチャート・シーケンス図・ガントチャートを、構文を書かずに一覧とプロパティ欄で編集できます。正本は Mermaid のソースのままで、GUI の1回の操作は必要な部分だけを書き換え、結果を読み直して描画できることを確かめてから確定し、Undo 1回で戻せます。完全に理解できない構文を含む図は、書き換えずに読み取り専用にします。
- **画像ブロック** — PNG・JPEG・WebP・SVG・GIF をドラッグ & ドロップで追加。
- **Git 連携** — 状態・ステージ / 解除・コミット・履歴・タブで開く左右比較の差分・変更の破棄・フェッチ / プル / プッシュ・ブランチ表示。
- **外部変更の検知** — 他のエディタ・Git・AI ツールによる変更を検知します。未保存の変更が無い Document は自動で読み直し、ある場合は「読み直す / 今の内容を維持 / 比較」から選べます。
- **AI / MCP** — `design-dawn-mcp`：Claude Code などの AI クライアントが Document・Sheet・Block を読み書きできるローカルの MCP サーバー（標準入出力のみ、既定は読み取り専用）。
- **ライト / ダークのテーマ**、**英語 / 日本語** の表示。

| フローチャートの GUI 編集 | シーケンス図の GUI 編集 |
|---|---|
| ![ノード一覧とプロパティ欄のあるフローチャートの編集](docs/images/flowchart-gui.png) | ![参加者とメッセージの一覧があるシーケンス図の編集](docs/images/sequence-gui.png) |

| Markdown の編集 | Git の差分 |
|---|---|
| ![ソースとプレビューの分割表示](docs/images/markdown-edit.png) | ![Markdown ブロックの左右比較の差分](docs/images/git-diff.png) |

| ガントチャートと円グラフ | ライトテーマ |
|---|---|
| ![シート上のガントチャートと円グラフ](docs/images/plan.png) | ![ライトテーマの概要シート](docs/images/light-theme.png) |

## Project の保存形式

```text
my-project/
├── project.json                  # Project 名と Document の順序
├── system-design.dawn            # ファイルマネージャーから Document を開く入口
└── documents/
    └── system-design/
        ├── document.json         # Sheet の順序
        ├── assets/               # 画像
        └── sheets/
            └── overview/
                ├── sheet.json    # Block の位置・大きさ・種類
                └── blocks/
                    ├── markdown-1.md
                    └── mermaid-1.mmd
```

配置は小さな JSON に、内容は `.md` / `.mmd` に分けて保存するため、差分が読みやすく、人や AI が他の部分に触れずに1つの Block だけを変更できます。
形式の詳細は [`docs/file-format.md`](docs/file-format.md) にあります。

## ビルドと実行

開発はすべて開発コンテナの中で行います。ホストに必要なのは Docker だけです。

**前提**: Linux、または WSL2（WSLg 有効）を使う Windows 11 と Docker（Windows では WSL2 バックエンドの Docker Desktop）。リポジトリは Linux / WSL2 側のファイルシステムに clone してください。

```sh
docker compose build                 # 開発用イメージを作る
docker compose up -d                 # 開発コンテナを起動
docker compose exec dev npm ci       # 依存をインストール
docker compose exec dev npm run tauri dev   # アプリを起動（ウィンドウは WSLg / X11 で表示）
```

その他のコマンド:

```sh
docker compose exec dev npm run verify   # 型チェック・Biome・Vitest・ライセンス検査・cargo fmt / clippy / test
docker compose exec dev npm run build    # フロントエンドの本番ビルド
docker compose exec dev npm run tauri build -- --bundles deb   # Linux のパッケージ
```

WSLg の注意点や既知の制限を含む詳細は [`docs/environment.md`](docs/environment.md) を参照してください。

## AI（MCP）から使う

```sh
docker compose exec dev cargo build --release --manifest-path src-tauri/Cargo.toml --bin design-dawn-mcp
claude mcp add design-dawn -- /path/to/design-dawn-mcp --project /path/to/my-project
```

`--allow-write` を付けて起動しない限り読み取り専用です。Document・Sheet の削除、コマンドの実行、Git の操作、ネットワーク接続はできません。詳細は [`docs/mcp.md`](docs/mcp.md)。

## ドキュメント

要件・アーキテクチャ・データモデル・ファイル形式・UI 設計・セキュリティ・テスト・ロードマップは [`docs/`](docs/README.md) にあります（日本語）。

## ライセンス

Design Dawn 本体のライセンスは未定です。同梱している依存ライブラリの第三者ライセンスは [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) に記載しています。
