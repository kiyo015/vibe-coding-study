# Day2 (2026-09-01 火) 学習成果物 — CLAUDE.md実践・スコープ設計

## 今日学んだこと

### サブディレクトリスコープの仕組み

- **適用範囲** — サブディレクトリのCLAUDE.mdは、そのディレクトリ配下で作業する時だけ読み込まれる
- **優先順位** — 直下（全体共通の方針・禁止事項）＋サブディレクトリ（そのプロジェクト固有のコマンド・規約）が**両方合成**される。矛盾する場合のみサブディレクトリが優先。今回は矛盾でなく「棲み分け」——直下=方針、サブディレクトリ=技術詳細、という役割分担が正確な理解
- **import構文** — CLAUDE.md内から他ファイルを取り込む記法がある（`@path/to/file`形式）。1プロジェクト内で規約文書が肥大化した時に使う。今回のケース（プロジェクトごとの棲み分け）では不要と判断
- **書きすぎ弊害** — 直下に全サブプロジェクト分のコマンドを書くと、無関係な作業中にも他プロジェクトのコマンドがコンテキストに乗り続けノイズになる

### 実例分析: `game`のモノレポ構成

`game`配下の4プロジェクト（AbyssDraw / CatCafeRecruit / StellaPact / pachinko）のnpm scriptsを比較。

| | dev | build | test | lint | 固有スクリプト |
|---|---|---|---|---|---|
| AbyssDraw | vite | tsc -b + vite build | vitest | — | — |
| CatCafeRecruit | vite | vite build | vitest | — | gen / package / obsidian |
| StellaPact | vite | tsc + vite build | — | — | fix:png-alpha / generate:bgm / zip:itch |
| pachinko | vite | tsc -b + vite build | vitest + test:reel | eslint | gen:drum-symbols / split:drum-symbols |

`dev`は全プロジェクト共通だが、`build`（TSコンパイル有無）・`test`（有無）・`lint`（pachinkoのみ）・固有スクリプト（ゲームごとのアセット生成）が全部バラバラ。`game`直下のCLAUDE.mdにコマンドが一切書かれていなかった理由が判明——**4つで違う情報を1枚に書けなかった**が正解。これがサブディレクトリスコープCLAUDE.mdが必要な典型例。

## 実践内容

`vibe-practice`にモノレポ構成を再現。

1. `frontend/`ディレクトリ新規作成（素のHTML/JS、バンドラー不使用）
   - `index.html` — メモ一覧表示＋追加フォーム
   - `app.js` — `/memos`をfetchでGET/POST/DELETE
2. `src/server.js`に静的配信を追加（`/`と`/app.js`を`frontend/`から返す）。同一オリジンにしてCORS問題を回避
3. `frontend/CLAUDE.md`新規作成 — バックエンドと異なる規約（バンドラー不使用・ESモジュール不使用・状態管理ライブラリ導入禁止）を明記
4. ルート`CLAUDE.md`のアーキテクチャ節に`frontend/`を追記、規約はサブディレクトリのCLAUDE.mdを参照するよう誘導
5. 動作確認 — `npm test`（既存4件パス、server.js変更の影響なし）＋ ブラウザでメモ追加・削除を実機確認、両方成功

### 追加インプット（詳細版）

- **import構文** — `@path/to/file`記法。用途は「1ファイルの規約が肥大化した時に分割する」であり、「複数プロジェクトに規約を配る」用途ではない（後者はサブディレクトリ分割の役目）。今回は該当なしと判断
- **合成の仕組み** — サブディレクトリCLAUDE.mdは「上書き」でなく直下の後ろに追記される形でシステムプロンプトに乗る。特別なマージ処理はなく、モデルが「より具体的な指示」を優先するという一般的性質の応用
- **実証実験** — `frontend/CLAUDE.md`に検証用の一時ルール（新規関数追加時は`// [frontend-rule-check]`コメント必須）を追加し、そのルールを一切教えていない別セッションのサブエージェントに`frontend/app.js`の軽微な編集を依頼。結果、サブエージェントは自ら「新規関数コメント規約は対象外（既存関数の編集だから）」と言及——ルールの存在と適用条件を自動で認識していたことを実証。検証後、一時ルールは削除
  - 副産物: メモ一覧に文字数表示`(N文字)`機能が追加された（実害なく採用）

## 成果物

本フォルダ配下に元と同じディレクトリ構造でスナップショット同梱（`vibe-practice/`以下）。

- [`vibe-practice/CLAUDE.md`](vibe-practice/CLAUDE.md)
- [`vibe-practice/frontend/CLAUDE.md`](vibe-practice/frontend/CLAUDE.md)
- [`vibe-practice/frontend/index.html`](vibe-practice/frontend/index.html) / [`app.js`](vibe-practice/frontend/app.js)
- [`vibe-practice/src/server.js`](vibe-practice/src/server.js)（静的配信追加）

## 次回（Day3）予告

スキル(Skills)概要。SKILL.md構成・descriptionによるトリガー方式・スキルとサブエージェントの使い分け方針。
