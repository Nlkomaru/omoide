# Omoide CLI 使い方ガイド

`@omoide/cli`（コマンド名: `omoide`）は、Sony α7C (`ILCE-7C`) などの写真アーカイブをローカルで整理し、Omoide API サーバーへアップロード・同期するための CLI ツールです。

---

## よく使う基本ワークフロー

SD カード（`F:\DCIM`）からアーカイブ先（`G:\My Drive\Photography\picture\YYYY-q1`〜`q4`）へ実行日の四半期フォルダごとに写真を整理し、JPEG をアップロードする基本手順です（PowerShell）。

```powershell
# 実行日から四半期フォルダ名（例: 2026-q1 / 1-3月:q1, 4-6月:q2, 7-9月:q3, 10-12月:q4）を生成
$d = Get-Date; $q = "$($d.Year)-q$([math]::Ceiling($d.Month / 3))"

# 1. SD カードの写真を日付 + UUIDv7 形式でアーカイブ先へ整理・移動（--dry-run で事前確認可）
omoide rename "F:\DCIM" --dest "G:\My Drive\Photography\picture\$q"

# 2. 整理したフォルダの JPEG をサーバーへアップロード
omoide sync "G:\My Drive\Photography\picture\$q"
```

---

## 1. セットアップと実行方法

### リポジトリ内から実行する場合

```bash
# 開発モードで直接実行（TypeScript）
# ※ pnpm v10 では `--` を付けると `--` 自体が引数として渡されるため付けずに実行します
pnpm --filter @omoide/cli dev <command> [options]

# 例: ヘルプを表示
pnpm --filter @omoide/cli dev help
```

### Windows でどこからでも `omoide` として呼び出す場合

現在 `@omoide/core` が TypeScript ソース（`.ts`）のまま参照されているため、`pnpm build:cli` で生成される `dist/index.js` を `node` から直接実行（または `pnpm link --global`）するとモジュール解決エラーになります。

どこからでも `omoide` コマンドとして使いたい場合は、PATH の通ったディレクトリにバッチファイル（`omoide.cmd`）を置くか、PowerShell プロファイルに関数を定義するのが確実です。

**`omoide.cmd` を PATH の通ったフォルダに置く例:**

```bat
@echo off
pnpm --dir "C:\path\to\omoide" --filter @omoide/cli --silent dev %*
```

**PowerShell (`$PROFILE`) に関数を追加する例:**

```powershell
function omoide {
    pnpm --dir "C:\path\to\omoide" --filter @omoide/cli --silent dev @args
}
```

---

## 2. 設定と環境変数

認証情報やデフォルト設定は以下の JSON ファイルに保存されます。

- **Linux / macOS**: `~/.config/omoide/config.json`
- **Windows**: `%APPDATA%\omoide\config.json`

### 環境変数による上書き

設定ファイルよりも環境変数が優先されます。

| 環境変数              | 説明                                                 | 例                            |
| --------------------- | ---------------------------------------------------- | ----------------------------- |
| `OMOIDE_API_URL`      | API サーバーのベース URL                             | `https://omoide.nikomaru.dev` |
| `OMOIDE_API_KEY`      | `omod_` で始まる API キー                            | `omod_xxxxxxxx...`            |
| `OMOIDE_PHOTO_DIRS`   | デフォルトのスキャン対象ディレクトリ（カンマ区切り） | `/mnt/photos,~/Pictures`      |
| `OMOIDE_JPEG_QUALITY` | JPEG 再エンコード時の品質（`1`〜`100`）              | `85`                          |
| `OMOIDE_MAX_BYTES`    | 圧縮後の最大目標バイト数                             | `1048576`                     |
| `OMOIDE_CONCURRENCY`  | アップロード並列数（上限 `16`）                      | `4`                           |

### デフォルトのスキャン対象ディレクトリ

コマンド引数でパスを省略した場合、以下の順序で対象ディレクトリが決定されます。

1. `OMOIDE_PHOTO_DIRS` または `config.json` の `photoDirs` に設定されたディレクトリのうち、存在するもの
2. （未設定かつ **Windows** の場合）`F:\DCIM` または `F:\`（両方存在する場合は `F:\DCIM` のみ）
3. （未設定かつ **Linux / macOS** の場合）デフォルトは空のため、コマンド引数でパスを指定する必要があります

---

## 3. コマンド一覧

### `omoide auth` — 認証情報とデフォルト設定の保存

API サーバーの URL や API キー、よく使うオプションを `config.json` に保存します。

```bash
omoide auth --url <server-url> --api-key <omod_...> [options]
```

| オプション             | 必須  | 説明                                                             |
| ---------------------- | ----- | ---------------------------------------------------------------- |
| `--url <server-url>`   | 任意  | サーバー URL（未指定時は既存設定または `http://localhost:3000`） |
| `--api-key <omod_...>` | 必須* | Web UI で発行した `omod_` API キー（既存設定がある場合は省略可） |
| `--dirs <dir1,dir2>`   | 任意  | デフォルトでスキャンするディレクトリ（カンマ区切り）             |
| `--quality <1-100>`    | 任意  | デフォルトの JPEG 圧縮品質                                       |
| `--max-bytes <bytes>`  | 任意  | デフォルトの JPEG 最大目標バイト数                               |
| `--concurrency <n>`    | 任意  | デフォルトのアップロード並列数                                   |

#### 例

```bash
omoide auth \
  --url https://omoide.nikomaru.dev \
  --api-key omod_your_api_key_here \
  --dirs "F:\DCIM,D:\Pictures\Archive" \
  --max-bytes 1048576 \
  --concurrency 4
```

---

### `omoide sync` — 写真（JPEG / RAW）の同期・アップロード

指定したディレクトリを再帰的にスキャンし、`.jpg` / `.jpeg`（および同名の `.arw` ペア）を検出してサーバーへアップロードします。

```bash
omoide sync [paths...] [options]
```

| オプション            | 説明                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| `--with-raw`          | ペアの `.ARW` RAW ファイルも同時にアップロードする                          |
| `--quality <1-100>`   | JPEG 再エンコード品質を指定する（`--max-bytes` 未超過時または無効時に適用） |
| `--max-bytes <bytes>` | 圧縮後の最大目標バイト数（デフォルト: `1048576` = 1MB）                     |
| `--concurrency <n>`   | 並列アップロード数（デフォルト: `4`、最大 `16` に制限）                     |
| `--dry-run`           | 実際のアップロードは行わず、対象ファイルと処理内容のみ表示する              |

#### 主な挙動

- **重複排除**: ローカルで元 JPEG の SHA-256 を計算し、サーバー上の登録状況と照合します。すでに登録済みの写真はスキップされます。
- **既存写真への RAW 自動補完**: サーバーに登録済みの写真であっても、RAW が未登録かつローカルに `.ARW` が存在し、`--with-raw` が指定されているかサーバー上で「お気に入り (`isFavorite`)」に登録されている場合は、`.ARW` のみ追加アップロードされます。
- **JPEG 圧縮**: 元 JPEG が `maxBytes` を超える場合、`mozjpeg` で段階的に品質調整・リサイズ（quality 85 → 75 → 長辺 3840px → 長辺 2880px）を行ってサイズを抑えます。
- **除外対象**: `output/` ディレクトリ、`.` で始まるファイル/フォルダ、`.rrdata` ファイル、`node_modules` 等はスキャン対象外です。

#### 例

```bash
# デフォルトディレクトリをドライランで確認
omoide sync --dry-run

# 指定フォルダを RAW 付きでアップロード
omoide sync "F:\DCIM\100MSDCF" --with-raw
```

---

### `omoide sync-developed` — 現像済みバリエーションの紐付け

すでにサーバーへアップロード済みの写真に対して、現像済み画像（WebP / PNG / JPEG / AVIF）や `.ARW` RAW ファイルを紐付けます。**ベース JPEG 自体のアップロードは行いません。**

```bash
omoide sync-developed <session-dir> [options]
```

| オプション                 | 必須 | 説明                                                              |
| -------------------------- | ---- | ----------------------------------------------------------------- |
| `<session-dir>`            | 必須 | 現像セッションディレクトリのパス                                  |
| `--photo-dirs <dir1,dir2>` | 任意 | 元の `.JPG` / `.ARW` を探すアーカイブディレクトリ（カンマ区切り） |
| `--with-raw`               | 任意 | ペアの `.ARW` をアップロードする（デフォルト動作）                |
| `--without-raw`            | 任意 | `.ARW` のアップロードをスキップする（`--with-raw` とは併用不可）  |
| `--concurrency <n>`        | 任意 | 並列数（デフォルト: `4`、最大 `16`）                              |
| `--dry-run`                | 任意 | 実際にはアップロードせず、紐付け予定のみ表示する                  |

#### セッションディレクトリの構成と紐付けルール

`<session-dir>` 配下を以下のようにスキャンします。

```text
2026-06-16_higashiyama/
├── DSC01932.ARW
├── DSC01932.JPG          # 省略時は --photo-dirs やデフォルトディレクトリから検索
└── output/
    ├── webp/
    │   └── DSC01932.00000000.webp
    └── png/
        └── 01.png
```

- `output/` 内の `.webp`, `.png`, `.jpg`, `.jpeg`, `.avif` ファイルが検出されます。
- ベース写真との紐付けは以下の優先順で行われます。
  1. ファイル名先頭がステムと一致（完全一致、または `DSC01932.` / `DSC01932_` / `DSC01932-` のプレフィックス一致）
  2. 1 始まりの連番（例: `01.png` → 名前順に並べた 1 番目のステム）
- ベース JPEG が未アップロード（サーバーに見つからない）の場合は警告を出してスキップします。事前に `omoide sync` でベース写真をアップロードしておいてください。

#### 例

```bash
# 現像セッションを同期（RAW も同時にアップロード）
omoide sync-developed "D:\Pictures\photos\2026-06-16_higashiyama"

# RAW はスキップし、別ディレクトリにある元 JPEG を参照して同期
omoide sync-developed ./session --photo-dirs ~/Pictures/archive --without-raw
```

---

### `omoide sync-favorites` — お気に入り写真の未アップロード RAW を一括同期

サーバー上で「お気に入り (`isFavorite = true`)」かつ「RAW 未登録 (`hasRaw = false`)」の写真一覧（最大 200 件）を取得し、ローカルから対応する `.ARW` ファイルを探してアップロードします。

```bash
omoide sync-favorites [paths...] [options]
```

| オプション          | 説明                                               |
| ------------------- | -------------------------------------------------- |
| `--concurrency <n>` | 並列数（デフォルト: `4`）                          |
| `--dry-run`         | 実際にはアップロードせず、対象ファイルのみ表示する |

#### 例

```bash
omoide sync-favorites "D:\Pictures\Archive" --dry-run
omoide sync-favorites "D:\Pictures\Archive"
```

---

### `omoide rename` — 撮影日 + UUIDv7 形式へのファイル整理

ローカルの写真ディレクトリをスキャンし、EXIF の撮影日時をもとに `YYYY-MM-DD/<uuidv7>.<ext>` のディレクトリ構成へリネーム（またはコピー）します。同じディレクトリ内で同じファイル名ステムを持つ RAW と JPEG（例: `DSC02897.ARW` と `DSC02897.JPG`）には同一の UUIDv7 が割り当てられます。

```bash
omoide rename [paths...] [options]
```

| オプション     | 説明                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------- |
| `--dest <dir>` | 出力先ルートディレクトリ（省略時は各ファイルの親ディレクトリ直下に `YYYY-MM-DD/` を作成） |
| `--copy`       | 移動（リネーム）ではなくコピーを行う                                                      |
| `--dry-run`    | ファイルを変更せず、先頭 10 件のプレビューと件数サマリーを表示する                        |

#### 対応拡張子と仕様

- **対応 RAW**: `.arw`, `.cr2`, `.cr3`, `.nef`, `.dng`
- **対応 JPEG / HEIF**: `.jpg`, `.jpeg`, `.hif`, `.heif`
- すでに `YYYY-MM-DD/<uuidv7>.<ext>` の形式になっているファイルは自動的にスキップされます。
- EXIF の取得に失敗した場合はファイルの更新日時 (`mtime`) とデフォルトタイムゾーン (`+09:00`) を使用します。

#### 例

```bash
# 変更内容を事前確認
omoide rename "F:\DCIM" --dest "D:\Pictures\Archive" --dry-run

# 別ドライブへコピーして整理
omoide rename "F:\DCIM" --dest "D:\Pictures\Archive" --copy
```

---

### `omoide post add` — SNS 投稿リンクの登録

アップロード済みの写真に対して、SNS やブログへの投稿 URL を紐付けます。

```bash
omoide post add --photo <uuidv7> --platform <platform> --url <post-url> [options]
```

| オプション              | 必須 | 説明                                                     |
| ----------------------- | ---- | -------------------------------------------------------- |
| `--photo <uuidv7>`      | 必須 | 対象の写真 ID（UUIDv7）                                  |
| `--platform <platform>` | 必須 | `instagram` / `twitter` / `blog` / `portfolio` / `other` |
| `--url <post-url>`      | 必須 | 投稿の URL                                               |
| `--caption <text>`      | 任意 | 投稿キャプション                                         |
| `--development <id>`    | 任意 | 特定の現像バリエーション ID に紐付ける場合に指定         |

#### 例

```bash
omoide post add \
  --photo 0195a1b2-c3d4-7000-8000-000000000001 \
  --platform twitter \
  --url "https://x.com/example/status/1234567890" \
  --caption "東山にて"
```
