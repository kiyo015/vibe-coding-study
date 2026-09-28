# Day18 学習記録（2026-09-28）— プラグインの配布とユーザー全体設定

基幹システム開発計画の4日目。Day17で作ったDB破壊ガードは**Studyで作業している時しか効かなかった**。今日は dev-guard を絶対パスなしで sales-core に配布し、そこで実際にフックが発火することを対照実験つきで確かめた。あわせて、個人の好みとチームの決まりを別のファイルに分けた。

## 今日行った処理

### 1. 現状を調べた

Study の `.claude/settings.json` は、自分自身のフォルダ（`"path": "."`）をマーケットプレイスとして登録していた。これを sales-core にそのまま持ち込むことはできない。

| 書き方 | 問題 |
|---|---|
| Study の絶対パスを書く | 他の人のPCには存在しない（完了条件違反） |
| `"path": "../Study"` | 「sales-core の隣に Study がある」という配置に依存する。メンバーは Study を持っていない |

リポジトリの公開状態も確認した。`kiyo015/vibe-coding-study` は PUBLIC。**GitHub から誰でも取得できる**ことが、配布方式の決め手になった。

### 2. 公式ドキュメントで仕様を確かめた

判断に使った事実は4つ。

| 事実 | 今日への影響 |
|---|---|
| リポジトリの `extraKnownMarketplaces` は**信頼済みのフォルダでだけ効き**、未信頼なら**黙って無視**される | sales-core は Day16 に信頼を承認済み。していなければ今日の設定は効かなかった |
| マーケットプレイスが**相対パスで載せたプラグイン**は、設定が効けば手動インストールなしで入る | dev-guard はこれに該当。メンバーは信頼を承認するだけでよい |
| `github` ソースは `ref`（タグ・ブランチ）で固定できる | バージョン固定に使う |
| 読み込まれたプラグインは `init` イベントの `plugins` に出る | 検証方法として使う |

### 3. 配布方式を決めた

計画の二択（独立リポジトリに出す／git URLのマーケットプレイス）のうち、**既存の公開リポジトリ vibe-coding-study をそのまま GitHub のマーケットプレイスとして使う**方を選んだ。`marketplace.json` は既にあり、公開済みなので、**追加で作るものがゼロ**。独立リポジトリに切り出すと、テスト・E2E・健康診断の置き場所も分かれ、今は利点が無い。

**バージョンはタグで固定した。** Study のリポジトリは学習記録も含めて毎日更新される。最新版を指すと、プラグインの変更がレビューなしで sales-core に流れ込む。

```bash
git tag dev-guard-v1.2.0     # plugin.json の version も 1.2.0
git push origin dev-guard-v1.2.0
```

sales-core の `.claude/settings.json` に追加した内容:

```json
"extraKnownMarketplaces": {
  "vibe-study": {
    "source": { "source": "github", "repo": "kiyo015/vibe-coding-study", "ref": "dev-guard-v1.2.0" }
  }
},
"enabledPlugins": { "dev-guard@vibe-study": true }
```

更新したい時は `ref` のタグを上げるPRを出す。変更がレビューを通るようにするため。

### 4. 読み込まれたかを基準値と比べた

**変更前の基準値を先に取った。** 比べる相手が無いと「効いた」と言えない。

| | sales-core で読み込まれたプラグイン |
|---|---|
| 変更前 | ponytail・superpowers・genshijin・dig・claude-code-setup（ユーザー全体の5個）。**dev-guard は無い** |
| 変更後 | 上の5個 ＋ **dev-guard**（`~/.claude/plugins/cache/vibe-study/dev-guard/1.2.0`） |

取得元が GitHub のタグ固定版（キャッシュの 1.2.0）であることも確認した。

### 5. フックが sales-core で発火するかを対照実験で確かめた

「読み込まれた」と「止める」は別。guard-e2e にセルを1つ足した。

先に安全を確認した。対照ではガードを外して `dotnet ef database drop --force` を実際に実行させるため。

```
$ dotnet ef --version   （sales-core で実行）
指定されたコマンドまたはファイルが見つからなかったため、実行できませんでした。
$ dotnet tool list
（0件）
```

コードの変更は、既存の `probeToolHook` に作業フォルダの引数 `cwd` を1つ足しただけ。判定ロジックには触れていない。

```
pass  PowerShellツール × dev-guardフック
pass  Bashツール × dev-guardフック(DBを壊すコマンド)
pass  Bashツール × dev-guardフック(DBを壊すコマンド・sales-core・GitHub配布)   ← 新規
pass  Readツール × permissionsのdeny(秘密情報ファイル・sales-core)
pass  サブエージェント(team-reviewer) × tools制限
pass  ヘッドレス(健康診断のaskClaude) × --tools "" ＋ --strict-mcp-config
費用: $0.4515
```

新セルは「ガードあり: blocked-by-guard ／ ガードなし: executed」。**sales-core でフックが発火し、止めているのは dev-guard だと示せた。**

### 6. 個人設定とチームの決まりを分けた

sales-core の CLAUDE.md は「個人の好みは各自の `~/.claude/CLAUDE.md` に書く」と案内していたのに、**案内先のファイルが存在しなかった**。

判断の基準は「**誰が書いても揃っている必要があるか**」。

| 項目 | 置き場所 | 理由 |
|---|---|---|
| 応答は日本語 | 個人 | 会話の言語は本人の好み |
| 本人が行う操作（ログイン・Secrets登録・信頼の承認・公開設定の切り替え） | 個人 | 本人との約束。どのプロジェクトでも同じ |
| 文書・コメント・コミットメッセージは日本語、識別子は英語 | **チーム** | メンバーごとに言語が違うと、リポジトリの文書が混ざる |
| 用語は glossary.md に揃える | チーム | 同上 |

`~/.claude/CLAUDE.md` は全プロジェクトで常に読み込まれるので短く保った。「リポジトリに文書の言語の決まりがあれば、そちらに従う」と書き、個人設定がチームの決まりを上書きしないようにした。

`sales-core/CLAUDE.md` には「書き方の決まり（チーム共通）」と「安全柵（dev-guard）の入手と更新」の節を足し、DB破壊ガードの行を「Studyでだけ効く」から「強制（2026-09-28 にこのリポジトリで対照実験付きで確認）」に直した。

### 7. 完了条件を検証した

| 確認 | 方法 | 結果 |
|---|---|---|
| 絶対パスが無い | settings.json をドライブ文字・`/c/`・`Users` で検索 | なし |
| 個人の好みが残っていない | CLAUDE.md を「応答・口調・敬語・ログイン・信頼の承認」で検索 | 案内文1行のみ（好みそのものではない） |
| 両方の指示が読まれている | `--tools ""`（ファイルを読めない状態）で新しいセッションに質問 | 出典のファイル名つきで両方とも正しく回答 |

ファイルを読めない状態で聞いたので、答えは起動時に読み込まれた指示だけから出ている。

## 今日学んだこと

### マーケットプレイスの登録は、マシン全体で名前ごとに1つ

sales-core を開いた直後、`~/.claude/plugins/known_marketplaces.json` の `vibe-study` が directory から github に**上書きされていた**。Study も sales-core も、同じ名前を別の取得元で登録しているため。

「最後に開いたプロジェクト次第で、読み込まれる版が変わるのではないか」という仮説を立て、交互に開いて確かめた。

| 順番 | 開いたプロジェクト | 登録ファイル | 読み込まれた dev-guard |
|---|---|---|---|
| 1 | sales-core | github（タグ固定） | キャッシュの 1.2.0 |
| 2 | Study | **directory に戻った** | Study の作業中のコード |
| 3 | sales-core | **github に戻った** | キャッシュの 1.2.0 |

仮説の前半（登録は行き来する）は当たり、**後半（読み込む版が狂う）は外れた**。起動のたびにそのプロジェクトが自分の登録で上書きするので、どちらも意図どおりの版を読む。Study は開発用に作業中のコードを、sales-core は安定したタグ固定版を読む。

影響を受けるのは両方を持っているプラグイン作者のマシンだけ。直さずに限界として `guard-matrix.md` に記録した。E2E の実行中にもこの行き来が何度も起きていて、その中で全セルが通ったことが裏付けになった。

### 「信頼の承認」は配布の前提条件だった

Day16 で見つけた「未信頼だと許可ルールが黙って無視される」問題は、今日の配布にもそのまま効いていた。`extraKnownMarketplaces` も未信頼なら無視される。先週承認しておかなければ、設定を入れても dev-guard は入らず、**エラーも出なかった**。新しいメンバー向けに、この点を sales-core の CLAUDE.md に先に書いた。

### 個人とチームの境目は「揃っている必要があるか」

言語という同じテーマでも、会話の言語は個人、リポジトリに残る文書の言語はチーム。項目の種類ではなく、**その結果が他のメンバーに影響するか**で置き場所が決まる。

## つまずき

### 見出しを二重にした

**症状** — `guard-matrix.md` の更新で「## 次に自動化するセル」の見出しと説明文が2回入った。

**原因** — Edit の置換範囲に見出しを含めていないのに、置換後の文字列に見出しを書いた。

**対策** — grep で見出しの出現位置を数えて気付き、「想定した並びかどうか」を確認してから消すスクリプトで直した。並びが違えば止まるように書いた。Day15〜17 のバックスラッシュの件と同じく、**書き換えの結果を目で見るまで信用しない**。

## 気づき・発見

### sales-core は意図的に公開している

sales-core が PUBLIC になっていることを報告したところ、**学習のエビデンスを公開するため意図的に公開している**との回答だった。計画シートと daily-closeout スキルに残っていた「private」を直し（3か所）、「非公開化を提案しない。その代わり秘密情報は絶対にコミットしない」を記憶に保存した。sales-core は vibe-coding-study から dev-guard を取得しているので、**vibe-coding-study も公開のままにする必要がある**。

### ローカルDBの接続文字列は公開しても入られないか

推測ではなく3か所を実測した。

| 確認したこと | 結果 |
|---|---|
| 待ち受けアドレス（netstat） | `0.0.0.0:5432`：全インターフェースで待ち受けている |
| `pg_hba.conf` | `127.0.0.1/32` と `::1/128` だけ許可：**他のPCからは認証の前に拒否** |
| ファイアウォール | 5432番の受信許可ルールなし、ネットワークは「パブリック」：**外からの接続は届かない** |

外からの接続は2段階で止まる。ただし、**パスワードを他で使い回していないこと**と、**`postgres`（スーパーユーザー）で接続しないこと**が条件。

それでも接続文字列は user-secrets に置く方針を続ける。理由は安全性よりもチーム開発の都合で、パスワードやポートは開発者ごとに違うため、1つをコミットしても他のメンバーの環境では動かない。Day19 で専用ロール `salescore_dev` を作る。

## 成果物

### sales-core（製品コード）

- [.claude/settings.json](https://github.com/kiyo015/sales-core/blob/day18/.claude/settings.json) — dev-guard を GitHub からタグ固定で取得する設定
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day18/CLAUDE.md) — 書き方の決まり（チーム共通）・安全柵の入手と更新・DB破壊ガードの行を更新

### Study（学習記録・E2E）

- [checks/guard-e2e.js](https://github.com/kiyo015/vibe-coding-study/blob/day18/checks/guard-e2e.js) — sales-core・GitHub配布のセルを追加
- [checks/guard-matrix.md](https://github.com/kiyo015/vibe-coding-study/blob/day18/checks/guard-matrix.md) — sales-core の行を追加、登録が行き来する件を記録
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day18/study_plan_next_month.md) — Day18 の実施内容と実測値、公開の記述を修正
- [.claude/skills/daily-closeout/SKILL.md](https://github.com/kiyo015/vibe-coding-study/blob/day18/.claude/skills/daily-closeout/SKILL.md) — 公開の記述を修正
- [2026-09-28/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day18/2026-09-28/summary.md) — この記録
- [2026-09-28/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day18/2026-09-28/summary.html) — 配布用HTML

### リポジトリの外

- `~/.claude/CLAUDE.md` — 個人設定（新規）。個人のファイルなのでコミットしない
- タグ `dev-guard-v1.2.0`（vibe-coding-study）— sales-core が参照するプラグインの版

## 次回予告

**Day19 — DB接続とテスト用DBの実証、週次振り返り**

- 専用ロール `salescore_dev` を作り、接続文字列を `user-secrets` に置く（`postgres` では接続しない）
- EF Core（Npgsql）を導入し、空のマイグレーションを1本通す
- テスト専用DBを作り、結合テストが**トランザクションのロールバックで独立する**ことを実証する
- 1週目の振り返り。未完了を2週目の先頭に書き写す

**完了条件:** 結合テストを2回連続で実行しても、DBの状態が積み上がらない

**持ち越し:** なし。今日の費用は約 $0.67（E2E $0.4515、読み込み確認などのヘッドレス実行5回で約 $0.22）。
