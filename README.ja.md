# Design Dawn — 自由に並べて、AI と書く。

[English](README.md) | **日本語** · [Web サイト](https://pg-refactor.github.io/Design-Dawn/ja/)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/PG-Refactor/Design-Dawn)](https://github.com/PG-Refactor/Design-Dawn/releases/latest)
![Platforms](https://img.shields.io/badge/platform-Windows%2011%20%7C%20Linux%20%28%E3%82%BD%E3%83%BC%E3%82%B9%E3%81%8B%E3%82%89%E3%83%93%E3%83%AB%E3%83%89%29-lightgrey.svg)
![Built with Tauri 2](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB.svg)
![MCP server](https://img.shields.io/badge/AI-MCP%20server-8A2BE2.svg)

**Design Dawn** は、設計書（設計ドキュメント・仕様書）を書くための無料・オープンソースのデスクトップアプリです（Tauri 2、Rust + TypeScript）。
メモ（**Markdown**）・**Mermaid の図**・**画像**を自由配置キャンバスの好きな場所に置き、Claude・Codex・GitHub Copilot・Cursor などの AI ツールとローカルの **MCP サーバー**経由で一緒に書けます（AI が手伝うのは許可した範囲だけ）。
すべて普通のテキストファイルとして保存されるので、Git で変更履歴を残し、ソースコードと同じようにプルリクエストでレビューできます（「Docs as Code」と呼ばれる進め方です）。

ドキュメントは複数のシートからなり、各シートに **Markdown**・**Mermaid の図**・**画像** のブロックを自由に配置できます。
すべてが通常のファイルとフォルダとして保存されるため、人が読み書きでき、Git でレビューでき、AI ツールも安全に変更できます。

![Markdown とキャプション付きの Mermaid フローチャートを置いた設計ドキュメント](assets/screenshots/overview-dark.png)

## 機能

- **自由配置キャンバス** — パン・ズーム（ホイール、または右下の拡大率の欄：- / + か数値の入力）・選択・移動・リサイズ・整列・重なり順・コピー / 貼り付け。すべての編集を元に戻せます（Undo / Redo）。
- **Project → Document → Sheet → Block** — フォルダつきの Project ツリー（行のドラッグで並べ替え・移動）、Document タブ、Sheet タブ。複数の Document（と複数のウィンドウ）を同時に開けます。サイドバーは畳めます。
- **Markdown ブロック** — キャンバス上では表示結果、編集中はソースとプレビューの分割表示（境界は動かせ、プレビューは隠せます。Mermaid のソース編集も同じ）。
- **Mermaid ブロック** — Mermaid 12 のすべての図を、ローカルで描画・サニタイズして表示します（ネットワーク・スクリプトなし）。
- **Mermaid の GUI 編集** — 円グラフ・フローチャート・シーケンス図・ガントチャートを、構文を書かずに一覧とプロパティ欄で編集できます。図の上の図形を右クリックして編集・削除でき、要素の追加はプレビュー付きのダイアログで行います。正本は Mermaid のソースのままで、GUI の1回の操作は必要な部分だけを書き換え、結果を読み直して描画できることを確かめてから確定し、Undo 1回で戻せます。完全に理解できない構文を含む図は、書き換えずに読み取り専用にします。
- **画像ブロック** — PNG・JPEG・WebP・SVG・GIF をドラッグ & ドロップまたはファイル選択で追加。
- **キャプション** — 図と画像に、上または下に表示する1行のキャプションを付けられます。
- **Git 連携** — 状態・ステージ / 解除・コミット・履歴・タブで開く左右比較の差分・変更の破棄・フェッチ / プル / プッシュ・ブランチ表示。
- **外部変更の検知** — 他のエディタ・Git・AI ツールによる変更を検知します。未保存の変更が無い Document は自動で読み直し、ある場合は「読み直す / 今の内容を維持 / 比較」から選べます。
- **AI / MCP** — `design-dawn-mcp`：Claude・Codex・GitHub Copilot・Cursor などの AI ツールが、あなたが許可した Project を読み書きできるローカルの MCP サーバー（標準入出力のみ）。どの Project も、アプリで（または AI からの依頼に答えて）編集を許可するまでは読み取り専用です。
- **読み込み時の問題の修復と形式の移行** — Project を開いたときに見つかった不整合（一覧に無い / 存在しない項目、ID の重複、使われていないファイル、中断した保存の残り）を通知パネルから修復できます。古い版で書かれたファイルは読み込み時に変換し、次の保存で新しい形式になります。
- **ライト / ダークのテーマ**、**英語 / 日本語** の表示。上部は「ファイル / 表示 / ヘルプ」のメニューバーにまとめています（バージョンとライセンスはヘルプから確認できます）。

| フローチャートの GUI 編集 | シーケンス図の GUI 編集 |
|---|---|
| ![ノード一覧と、ノードの右クリックメニューを出したフローチャートの GUI 編集](assets/screenshots/flowchart-gui.png) | ![メッセージを選び、その右クリックメニューを出したシーケンス図の GUI 編集](assets/screenshots/sequence-gui.png) |

| Markdown の編集 | Git の差分 |
|---|---|
| ![ソースとプレビューの分割表示](assets/screenshots/markdown-edit.png) | ![Markdown ブロックの左右比較の差分](assets/screenshots/git-diff.png) |

| ガントチャートと円グラフ | ライトテーマ |
|---|---|
| ![シート上のガントチャートと円グラフ](assets/screenshots/plan.png) | ![ライトテーマの概要シート](assets/screenshots/light-theme.png) |

| AI 連携（MCP） | AI からの編集許可の依頼 |
|---|---|
| ![登録するコマンドと AI に見せる Project の一覧がある AI 連携の画面](assets/screenshots/ai-integration.png) | ![AI が Project を編集してよいかをアプリが確認する画面](assets/screenshots/ai-request.png) |

（画面写真は英語表示です。）

## Design Dawn を使う理由

- **長い1本のページでも、ホワイトボードの独自ファイルでもない** — メモ・図・画面写真をホワイトボードのように並べつつ、各ブロックは `.md` / `.mmd` ファイルなので、プルリクエストで差分をレビューできます。
- **AI と一緒に書ける** — AI はローカルの MCP サーバー経由で操作し、許可するまでは読み取り専用。同時の変更は黙って上書きされず衝突として検出されます。
- **構文を覚えなくても Mermaid** — フローチャート・シーケンス図・ガントチャートを GUI で編集でき、正本は Mermaid のソースのままです。
- **オフライン・ローカル完結** — アカウント不要、クラウド不要、描画にネットワークを使いません。

主な用途：アーキテクチャ・システム設計書、API やシーケンスの設計、図入りの ADR、ガントチャートでの計画、Git での設計レビュー。

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
すべての JSON ファイルは `schemaVersion` を持ち、ID は変わらない UUID、表示名はフォルダ名と独立しています。

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
docker compose exec dev npm run tauri:build:windows   # Windows の .exe（クロスビルド、インストーラーなし）
```

注意:

- `node_modules` と Rust のビルド出力は Docker の名前付きボリュームに置き、ソースツリーには入れません。
- ウィンドウは WSLg の X11 で表示します（`compose.yaml` の `GDK_BACKEND=x11`）。
- `tauri:build:windows` は [cargo-xwin](https://github.com/rust-cross/cargo-xwin) で `design-dawn.exe` と `design-dawn-mcp.exe` を `src-tauri/target/x86_64-pc-windows-msvc/release/` にクロスビルドします。初回は Microsoft の CRT と Windows SDK（約 1 GB、Microsoft のライセンス）を Docker のボリュームにダウンロードします。`.exe` を Windows の任意の場所にコピーすれば実行できます（WebView2 ランタイムが必要で、Windows 11 には標準で入っています）。Tauri はこのビルド方法を試験的としているため、配布用のインストーラーは Windows 上で作ってください（[Windows のインストーラーを作る](#windows-のインストーラーを作る)）。
- リポジトリを Windows のドライブからマウントしている場合は、ファイル変更の通知が届かないことがあるため `DAWN_WATCH_POLLING=true` を設定してください。

## Windows のインストーラーを作る

インストーラーは Windows 上で作ります（開発コンテナでクロスビルドできるのは `.exe` だけです）。現時点ではコード署名をしていません。

**前提**（Windows 上）:

- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（「C++ によるデスクトップ開発」ワークロード）
- [Rust](https://rustup.rs/)（MSVC ツールチェーン。`rust-toolchain.toml` のバージョンは初回のビルドで自動的に入ります）
- [Node.js](https://nodejs.org/) 24 以上
- WebView2 ランタイム（Windows 11 には標準で入っています）

**ビルド**（PowerShell で、リポジトリを clone したフォルダで）:

```powershell
npm ci
npm run tauri build                                                   # アプリのインストーラー
cargo build --release --manifest-path src-tauri/Cargo.toml --bin design-dawn-mcp   # MCP サーバー
```

できるもの:

- `src-tauri\target\release\bundle\nsis\Design Dawn_<version>_x64-setup.exe`: NSIS のインストーラー
- `src-tauri\target\release\bundle\msi\Design Dawn_<version>_x64_en-US.msi`: MSI のインストーラー
- `src-tauri\target\release\design-dawn-mcp.exe`: MCP サーバー。まだインストーラーには含まれません。インストールした `design-dawn.exe` と同じフォルダに置き（AI 連携の画面はそこを探します）、そのパスを AI ツールに登録してください（下記）。

NSIS と WiX は初回のビルドで Tauri がダウンロードします。NSIS のインストーラーだけを作るときは `npm run tauri build -- --bundles nsis` を使います。

**署名なしのビルド**: 署名していないインストーラーを起動すると、Windows SmartScreen が「Windows によって PC が保護されました」と警告します。「詳細情報」から「実行」を選んでください。自分でビルドしたもの、または信頼できる入手元のものだけで行ってください。

## AI（MCP）から使う

`design-dawn-mcp` は、AI ツール（Claude・Codex・GitHub Copilot・Cursor などの MCP クライアント）が Design Dawn の Project を読み書きするためのローカルの MCP サーバーです。標準入出力だけで MCP を話し、ネットワークのポートは開かず、アプリが起動していなくても使えます。

**設定（AI ツールごとに1回）**: アプリで **ファイル → AI連携（MCP）** を開くと、登録するコマンド（アプリと同じフォルダの `design-dawn-mcp`）がコピーボタン付きで表示され、同じ内容を共通の JSON 形式でも表示します。

```json
{
  "mcpServers": {
    "design-dawn": { "command": "C:\\path\\to\\design-dawn-mcp.exe" }
  }
}
```

AI ツールの MCP サーバーの追加方法で登録してください（Claude Code の場合: `claude mcp add design-dawn -- <コマンド>`）。登録に Project を書く必要はありません。

**AI が使える Project**: AI 連携の画面で追加したものだけです（**今開いているProjectを追加**、または任意の Project フォルダを **フォルダを指定して追加…**）。AI はふだん、アプリで開いている Project（最後に使ったウィンドウのもの。アプリを閉じているときは最後に使ったもの）が追加されていればそれを扱います。AI は追加された Project の一覧を見て（`listProjects`）選べる（`selectProject`）ので、「order-service の Project を要約して」のような依頼も登録し直さずに使えます。

**権限**: 追加した Project は、横の **AIによる編集を許可** にチェックを入れるまで、AI からは読み取り専用です。AI から依頼することもでき（`requestWriteAccess`）、そのときはアプリが **許可する** / **今回だけ許可**（アプリを閉じるまで） / **許可しない** を尋ね、あなたの答えだけが反映されます。アプリで開いている Project も依頼の対象になり、許可すると一覧に追加されます。「許可しない」と答えた Project の依頼は、しばらく無視されます。この一覧を変えられるのはアプリだけで（アプリの設定フォルダの `ai-access.json` に保存し、Project の中には置きません）、AI が自分で Project を追加したり権限を与えたりすることはできません。画面から Project を一覧から外すこともできます。

- **ツール**: `listProjects`、`selectProject`、`requestWriteAccess`、`getProject`、`getDocument`、`getSheet`、`getBlock`。編集できる Project では、さらに `createDocument`、`createSheet`、`createBlock`（Markdown / Mermaid）、`updateDocument`、`updateSheet`、`updateBlock`、`moveBlock`、`updateBlockCaption`（Mermaid / 画像ブロックのキャプション）、`deleteBlock`。
- Block の本文を変えるときは、AI が `getBlock` で読んだ `contentHash` を `expectedContentHash` として渡します。その間に本文が変わっていれば `conflict` が返ります。
- Document・Sheet・Project の削除、ディスク上のファイルの取り込み、コマンドの実行、Git の操作、ネットワーク接続はできません。アプリがその Project を開いていれば、変更はすぐに表示されます。

**1つの Project に固定する**（アプリの一覧を使わない）: `--project <project.json があるフォルダ>` を付けて起動し、編集を許可するときは `--allow-write` も付けます。

```sh
claude mcp add design-dawn -- /path/to/design-dawn-mcp --project /path/to/my-project
```

サーバーだけをビルドする: `cargo build --release --manifest-path src-tauri/Cargo.toml --bin design-dawn-mcp`

## ライセンス

Design Dawn は [MIT License](LICENSE) で公開しています。同梱している依存ライブラリの第三者ライセンスは [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) に記載しています。
