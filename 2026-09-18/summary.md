# Day15 (2026-09-18 金) 作業記録 — 基幹システム開発の開始：骨格・C#対応・範囲拡大・ER図

基幹システム開発計画の初日。予定は「環境調査・骨格・`dev-guard`のC#対応」だったが、途中で**計画の日単位化**、**機能範囲の拡大（5段階）**、**ER図の作成**まで進めた。

## 今日行った処理

### 1. 環境調査と技術選定

読み取りだけで、手元の環境と既存資産を調べた。

| 項目 | 結果 |
|---|---|
| .NET SDK | 8.0.421 |
| GitHub CLI | ログイン済み（`kiyo015`） |
| PostgreSQL | **18が稼働中**（Windowsサービス） |
| Docker・SQL Server LocalDB | なし（Testcontainersは使えない） |
| 既存の`equipment-management` | PostgreSQL＋EF Core 8＋Npgsql。**接続文字列を`appsettings.json`に書いていた** |

決めたこと：置き場所は`C:\Users\sakaguchi\sales-core`（学習用とは別リポジトリ）、DBはPostgreSQL 18、テスト用DBはローカルのPostgreSQLにテスト専用DBを作る。

### 2. リポジトリの骨格

- `dotnet new`で6プロジェクト（`src`: Domain／Application／Infrastructure／Api、`tests`: Domain.Tests／Integration.Tests）を作成（1分14秒）し、参照関係を設定
- CLAUDE.md（ルールごとに**強制／お願い**を明記）、`.claude/settings.json`（`dotnet`コマンドの許可、force pushと**秘密情報ファイルの読み取りを禁止**）
- 接続文字列は`dotnet user-secrets`に置く（既存プロジェクトの反省）
- **GitHubにprivateリポジトリ`kiyo015/sales-core`を作ってpush**（`equipment-management`はリモートが無かった）

### 3. `dotnet test`の所要時間を測って、`dev-guard`の設計を決めた

| 実行 | 時間 |
|---|---|
| 初回（ビルド込み・全体） | 1分29秒 |
| 2回目（変更なし・全体） | 24.0秒 |
| Domain.Testsだけ（`--no-restore`） | 9.4秒 |
| 編集直後：ビルドのみ | 5.9秒 |
| **編集直後：対応するテストプロジェクトだけ** | **12.3秒** |
| 変更なし：`--no-build` | 7.3秒 |

`dev-guard`の編集後テストの上限は25秒。ソリューション全体を走らせると毎回超える。そこで**編集したファイルのプロジェクトに対応する`.Tests`プロジェクトだけ**を走らせる設計にした（`SalesCore.Domain` → `SalesCore.Domain.Tests`、命名規約で対応付け）。

### 4. `dev-guard` 1.1.0：編集後の自動テストをC#に対応

- テストを先に6件書き、「関数が無い」で落ちることを確認してから実装した（計15件）
- C#の上限を60秒、フック自体の上限を90秒に引き上げた（テストは今後増えるため）
- 実物（`sales-core`）で確認：**成功時9.1秒で「全件パス」、わざと落ちるテストを置くと16.8秒で差し戻し**

### 5. 計画を日単位に直し、締めの手順を2リポジトリ対応にした

- 計画をDay15〜34の日単位にし、各日に**実測で判定できる完了条件**を付けた
- `daily-closeout`：記録は`Study`に、製品コードは`sales-core`に。**両方に同じタグ`day{N}`を打つ**。成果物に「今日行った処理（実測値つき）」「つまずき」を明示し、健康診断で締める

### 6. 機能範囲を広げ、5段階に分けた

`brainstorming`スキルで、1問ずつ決めた。

| 論点 | 決定 |
|---|---|
| 増やす機能 | 販売の完結、購買と在庫、画面と権限、帳票と外部連携（すべて） |
| 進め方 | 段階に分けて期間を延ばす（平日約78日） |
| 順番 | **画面と権限 → 販売の完結 → 購買と在庫 → 帳票と外部連携**（使える形を先に） |
| 画面 | Blazor Web App |
| ログイン | ASP.NET Core Identity |

### 7. ER図を先に作った

設計の途中で、ER図を先に作ることにした。テーブルの形を大きく変える4点を先に決めた：**締め請求＋出荷先と請求先の分離、分納あり、複数倉庫、得意先別単価あり（期間つき）**。

- 領域ごとに7枚のMermaid図（全体17表／マスタ7／販売14／購買9／在庫6／帳票と連携5／権限と監査4）
- 物理削除はせず取消は状態か赤黒で表す、消費税は税率ごとの集計で持つ、在庫は入出庫の履歴を正とする
- **Mermaid 11で7枚すべての構文チェックと描画を確認**

### 8. 設計を見直して食い違いを2つ直し、仕様書に確定させた

ER図と計画を並べると、**倉庫**（出荷が参照するのに段階2に割り当てていた）と**得意先別単価**（段階1では不要）の割り当てがずれていた。ER図を直し、段階1のゴールを「締め請求書の発行」に上げて、仕様書に確定させた。

## 今日学んだこと

- **設計は計測から決める。** `dev-guard`の25秒上限はJavaScriptでは十分だったが、C#ではソリューション全体が必ず超える。測らずに移植していたら、編集のたびに「打ち切り」で差し戻される道具になっていた
- **既存資産を読むと判断が速い。** PostgreSQLが稼働中で、既存プロジェクトも同じ構成だと分かった時点で、DBの選定はほぼ決まった。「接続文字列を`appsettings.json`に書いている」という反面教師も見つかった
- **基幹システムでは、機能を決める前にテーブルの形を決める論点がある。** 請求方式・分納・倉庫の数・単価の決め方は、後から変えると表の構造ごと作り直しになる。ER図を先に描いたのは正しい順番だった
- **図を描いただけでは食い違いに気づけない。** 計画と並べて初めて、倉庫と得意先別単価の段階の割り当てのずれが見えた
- **大きな参照資料は`@`で取り込まない。** ER図は約500行あり、取り込むと毎回の会話に常時コストが乗る。CLAUDE.mdにはパスだけを書き、必要な時に読ませる（Day1の学びの応用）

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| `dev-guard`を実物で試したら、何も返さなかった | シェル経由でWindowsパスを渡した際、バックスラッシュのエスケープが崩れて存在しないパスになっていた | スラッシュ区切りのパスで渡した |
| ER図の検証ページで、スクリプトが構文エラーになった | シェル経由で書いたJavaScriptの`\n`が崩れた | 生成スクリプトをファイルとして書いた |
| ローカルのHTMLファイルでは、ブラウザのスクリプトが動かなかった | ファイルとして開くと静的な表示になる | 簡易サーバーを立ててlocalhost経由で開いた（確認後に停止） |

## 気づき

- **シェル経由の文字列のエスケープで、今日は2回転んだ。** Day10（`printf`でJSONが崩れた）と同じ種類で、Day14で特定した弱点C（Windowsのシェル境界）そのもの。「複数行・バックスラッシュ・引用符を含むものは、シェルに渡さずファイルに書く」を習慣にする
- 計画にない作業（計画の日単位化、範囲の拡大、ER図）で1日の大半を使った。どれも後の手戻りを防ぐ作業だが、**予定との差は記録に残す**（計画シートに「予定と違う点」として記入した）

## 成果物

リンクはタグ`day15`に固定している。

**`sales-core`（製品コード）**
- [`CLAUDE.md`](https://github.com/kiyo015/sales-core/blob/day15/CLAUDE.md)
- [`.claude/settings.json`](https://github.com/kiyo015/sales-core/blob/day15/.claude/settings.json)
- [`docs/domain/er-diagram.md`](https://github.com/kiyo015/sales-core/blob/day15/docs/domain/er-diagram.md)（ER図・7枚）
- [`docs/specs/2026-09-18-scope-and-phases-design.md`](https://github.com/kiyo015/sales-core/blob/day15/docs/specs/2026-09-18-scope-and-phases-design.md)（機能範囲と段階構成の設計）
- [`SalesCore.sln`](https://github.com/kiyo015/sales-core/blob/day15/SalesCore.sln)

**`Study`（記録と道具）**
- [`study_plan_next_month.md`](https://github.com/kiyo015/vibe-coding-study/blob/day15/study_plan_next_month.md)（基幹システム開発計画・5段階）
- [`plugins/dev-guard/hooks/post-edit-test.js`](https://github.com/kiyo015/vibe-coding-study/blob/day15/plugins/dev-guard/hooks/post-edit-test.js) ／ [`post-edit-test.test.js`](https://github.com/kiyo015/vibe-coding-study/blob/day15/plugins/dev-guard/hooks/post-edit-test.test.js) ／ [`plugin.json`](https://github.com/kiyo015/vibe-coding-study/blob/day15/plugins/dev-guard/.claude-plugin/plugin.json)（1.1.0）
- [`.claude/skills/daily-closeout/SKILL.md`](https://github.com/kiyo015/vibe-coding-study/blob/day15/.claude/skills/daily-closeout/SKILL.md)（2リポジトリ対応）
- [`2026-09-18/summary.html`](https://github.com/kiyo015/vibe-coding-study/blob/day15/2026-09-18/summary.html)（配布用HTML版）

## 次回（Day16）

要件の骨格。業務フロー・用語集・業務ルール集の初版を作り、ER図の「まだ決めていないこと」（金額の桁と端数処理、売上計上の基準、締め日の種類と締め後の訂正、承認の基準額、仕入先請求書との照合）をここで決める。

持ち越し（1週目の残り）：DBを壊すコマンドのガード（Day17）、プラグインの配布方法と`~/.claude/CLAUDE.md`（Day18）。
