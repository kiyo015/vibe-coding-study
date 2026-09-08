# CLAUDE.md

このファイルは、このプロジェクトで作業する際にClaude Codeへ向けたガイドを提供する。

## コマンド

- `npm test` — 全テスト実行（`node --test`、`test/`配下を自動検出）
- `node --test test/game.test.js` — 単一テストファイルのみ実行
- `npm run dev` — サーバー起動（`server.js`）。`PORT`環境変数未指定時は3100番ポート。起動後 http://localhost:3100/ を開く

**`web/index.html`を直接開いても動かない。** UIは`src/game.js`をESモジュールとしてimportしており、ブラウザのCORS制約により`file://`では読み込めないため。プレイするには必ず`npm run dev`が要る（この制約に気づかず「動かない」となった実例があるので、`file://`で開かれた場合はその旨の警告が表示されるようにしてある）。

## アーキテクチャ

ESMプロジェクト（package.jsonの`"type": "module"`）。外部依存なし。

- `src/game.js` — ゲームロジック層。状態（答え・試行回数・終了フラグ）と判定を持つ。DOMには一切触れない
- `web/` — UI層。`src/game.js`をESモジュールとして直接importし、DOM操作だけを担当する
- `server.js` — 動作確認用の静的配信のみ。ゲームの処理は何も持たない（`web/index.html`がESモジュールを読むため`file://`では動かず、やむなく用意したもの）
- `test/` — `node:test`。乱数を固定値に差し替えて決定的にテストする

## 詳細ドキュメント

コーディング規約: @docs/conventions.md

ゲーム仕様・バランス調整の注意点: @docs/game-rules.md
