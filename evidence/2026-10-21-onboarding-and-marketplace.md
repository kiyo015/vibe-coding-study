# 初日の確認手順の試行と、マーケットプレイスの名前の重複で安全柵が黙って無効になった件（2026-10-21）

## 1. 見つけた経緯

sales-core の `docs/onboarding.md`（新しく参加した人が初日に安全柵を確かめる手順）を書く前に、手順の各項目を sales-core の新しいセッション（`claude -p`）で試した。

| # | 項目 | 1回目の結果 |
|---|---|---|
| 1 | Bash で `dotnet ef database drop --dry-run --project guard-probe-does-not-exist-7f3a` | `[pre-bash-guard]` で止まった |
| 2 | 同じコマンドを PowerShell で | **止まらずに実行された**（`MSB1009: プロジェクト ファイルが存在しません`。何も消えていない） |
| 3 | PowerShell で `git push --force --dry-run` | `Permission to use PowerShell ... has been denied.`（deny ルールで止まった） |
| 4 | Read で `.env` | `denied by your permission settings`、目印は返らない |
| 5（対照） | Read で同じ中身の `onboarding-probe-7f3a.txt` | 読めて、目印が返った |

2番をもう一度試しても、同じく止まらなかった。

## 2. 原因

- フックの判定そのもの（`pre-bash-guard.js` に同じ入力を直接渡す）は、Bash でも PowerShell でも `deny` を返した。
- `--debug` の記録には、次の行が出ていた。

```
Plugin loading errors: Plugin "dev-guard" not cached at C:\Users\sakaguchi\.claude\plugins\cache\vibe-study\dev-guard\1.1.0 — run /plugin to refresh
Skipping orphaned enabledPlugins entry dev-guard@vibe-study: marketplace not registered
```

- このとき、起動時の記録（`system:init`）の `plugins` には dev-guard が無かった（2回続けて同じ）。
- Study と sales-core は、どちらも `vibe-study` という名前のマーケットプレイスを登録していた（Study はローカルのフォルダ、sales-core は GitHub のタグ）。
  - マーケットプレイスの名前は、設定のキーではなく `marketplace.json` の `name` で決まる。マシン全体で名前ごとに1つしか登録できない。
  - 起動したリポジトリごとに、登録が上書きされていた。
- 今朝 00:17 に sales-core のセッションが、登録を GitHub（`dev-guard-v1.3.1`）に切り替えた。しかし、GitHub から取得した dev-guard はキャッシュに無かった。
  - 9/28 には `1.2.0` があったが、10/13 までに消えていた。
  - インストールの記録は、Study 用の欠けた `1.1.0` しか残っていなかった。
- それまで sales-core で止まっていたのは、登録が Study のローカルのフォルダを指していて、作業中のソースを読んでいたから。前日までの guard-e2e の「sales-core・GitHub 配布」のセルも、実際は GitHub 配布を通っていなかった可能性が高い。
- 読み込みの失敗は、画面には何も出なかった。

## 3. 直し方（本人の決定: 名前を分ける）

1. Study のローカル用の目録を `plugins/.claude-plugin/marketplace.json`（名前 `vibe-study-local`、プラグインは `./dev-guard`）として別に作り、`.claude/settings.json` をそれに向けた。ルートの `.claude-plugin/marketplace.json`（`vibe-study`）は GitHub 配布のために残した。
   - 設定のキーだけを `vibe-study-local` に変えた試しでは、`marketplace not registered` になり、登録は `vibe-study` のまま上書きされた。
2. sales-core で、`claude plugin marketplace remove vibe-study` を実行した。
   - **プロジェクトの `.claude/settings.json` からも、マーケットプレイスと enabledPlugins が消えた**ので、`git checkout` で戻した。
3. `claude -p` のセッションは、バックグラウンドの取得（`[reconcile] vibe-study(install)` → `git clone ... ref=dev-guard-v1.3.1`）を終える前に閉じた。90秒・60秒待たせても登録されなかった（clone そのものは単独で10秒で終わる）。
4. `claude plugin marketplace add "kiyo015/vibe-coding-study#dev-guard-v1.3.1" --scope local`（取得が終わるまで待つ）で登録した。
5. `claude plugin install dev-guard@vibe-study --scope project` で入れた。
   - `.claude/settings.json` は並び順が変わっただけだったので、`git checkout` で戻した。
   - `.claude/settings.local.json`（git に入らない）は `{}` にした。

## 4. 直した後

起動時の記録の `plugins` は次のとおり。

```
Study      [["dev-guard@vibe-study-local","1.3.1","C:\\Users\\sakaguchi\\Study\\plugins\\dev-guard"]]
sales-core [["dev-guard@vibe-study","1.3.1","C:\\Users\\sakaguchi\\.claude\\plugins\\cache\\vibe-study\\dev-guard\\1.3.1"]]
```

Study → sales-core の順に起動しても、上書きし合わない。`known_marketplaces.json` には、`vibe-study`（github）と `vibe-study-local`（directory）の2つが残る。

### 手順の1〜6を新しいセッションで試し直した結果

| # | 結果 |
|---|---|
| 1 | `PreToolUse:Bash hook error: [pre-bash-guard] 危険なコマンド(dotnet ef database drop)を検知` |
| 2 | `PreToolUse:PowerShell hook error: [pre-bash-guard] 危険なコマンド(dotnet ef database drop)を検知` |
| 3 | `PreToolUse:PowerShell hook error: [pre-bash-guard] 危険なコマンド(force push)を検知` |
| 4 | `File is in a directory that is denied by your permission settings.`（目印は返らない） |
| 5（対照） | 読めて、目印が返った |
| 6 | `[dev-guard] SalesCore.Domain.Tests: 編集後のテスト 全件パス`。足した空行は元に戻した |

- 6番は、最初は guard-e2e と同時に走らせたため、`テストが60秒以内に終わらず打ち切った` になった。空いてから試し直して全件パスした。

## 5. guard-e2e の変更

- sales-core のセルに `expectPlugin: 'dev-guard@vibe-study'` を足した。ガードありの時、起動時の記録で読み込み元が GitHub 配布でなければ合格にしない（`pluginSource`、テストを先に書いた）。
- 直した後の実行: 7セルすべて合格、$0.0654。
- 対照: 期待する読み込み元を `dev-guard@vibe-study-local` にすると、`wrong-plugin(dev-guard@vibe-study)` で判定不能になった。
