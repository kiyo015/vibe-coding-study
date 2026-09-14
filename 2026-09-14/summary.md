# Day11 (2026-09-14 月) 学習成果物 — チーム運用設計

## Day10の持ち越しと、締めた後の追加

- **プラグイン経由のhooksが発火することを確認した。** PostToolUseの出力に、プラグイン版で付けた新しいプレフィックス`[dev-guard]`が出た。旧`.claude/hooks/`は削除済みで、`settings.json`にも`hooks`キーは無いので、プラグイン版で動いていると確定
- Day10を締めた後、学習記録のHTML版を作り（`82d9ea0`）、以後の成果物をmdとHTMLの2本立てにするよう`daily-closeout`スキルを直した（`fa7df56`）。今日の記録から、HTMLも`day{N}`タグに含まれる

## 今日学んだこと

### 1. チームで共有する前に、個人の環境で「たまたま動いている」ものを探す

`.claude/`配下をチーム共有の目で点検すると、自分のPCでしか成り立っていない前提が4つ見つかった。

| 見つかったこと | なぜ問題か | 対応 |
|---|---|---|
| `settings.local.json`がリポジトリの`.gitignore`に入っていなかった。自分のPCでは個人のgit除外設定（`~/.config/git/ignore`）で隠れていただけ | 他の人がcloneすると、個人の許可ルールがコミットに混入する | `.gitignore`に追加 |
| 個人の許可ルールが63件溜まっており、うち11件は一度しか使わない承認の残骸 | チーム標準にそのまま持ち込むと、誰も意図していない権限が全員に付く | チーム標準は別に設計（下記） |
| **信頼を承認していないフォルダでは、プロジェクト設定の`permissions.allow`が無視される** | cloneした直後は、チームの許可ルールが効かない | 雛形に明記 |
| 同じフォルダが`C:/Users/...`と`C:\Users\...`の2通りで記録され、片方だけ未信頼 | アプリでは効くのに、ターミナルから起動すると効かない、が起きる | 雛形に明記 |

3つ目は、ヘッドレスで`claude -p`を起動した時に`Ignoring 4 permissions.allow entries from .claude/settings.json: this workspace has not been trusted.`と表示されて分かった。cloneしたリポジトリが自分自身に権限を与えられないようにする仕様。信頼の記録を手で書き換えれば回避できるが、それは安全装置を外すことなのでやらなかった。

### 2. 「お願い」と「強制」を区別してルールを書く

CLAUDE.mdに「禁止」と書いても、AIも人も破れる。技術的に止めているのは、設定（`permissions`）・hooks・サブエージェントの`tools`だけ。チーム向けCLAUDE.mdの雛形では、各ルールに**強制**か**お願い**かと、どこで止めているかを必ず書く形にした。

- 強制: force push等（denyルール＋フック、漏れあり）、テストが落ちたまま進む（PostToolUseフック）、レビュー役がコードを書き換える（`tools`で制限）
- お願い: 絶対パス・秘密情報・マジックナンバー（機械で判定しきれないのでレビューで拾う）

### 3. denyルールとフックは、それぞれ違う漏れ方をする

無害なコマンド（`git branch --list`）に一時的なdenyルールを付けて規則を確かめ、フックには入力を直接渡して判定を見た。

- **denyルール**は`&&`で連結されたコマンドを分解してから照合するが、分解後は**先頭一致しか見ない**。`git -C . reset --hard`や、フラグを後ろに置いた`git push origin main --force`は抜ける
- **フック（1.0.1まで）**は1本の正規表現で、書いていない表記（`-f`、`rm -fr`、`+main`）は抜ける
- 2つは漏れ方が違うので併用には意味があるが、`git push origin main -f`と`rm -fr`は**両方を抜けて止まらなかった**
- どちらも「禁止する書き方を列挙する」方式なので、穴はゼロにできない。**うっかりを防ぐ安全網であって、確実に禁じる仕組みではない。** 確実に禁じたい作業は、シェル系ツールを持たないサブエージェントに任せる

### 4. レビュー役の「読み取り専用」は、toolsで保証する

レビュー用サブエージェント`team-reviewer`を作った。

- `tools: Read, Grep, Glob`だけを与える。「書き換えないで」と頼むのではなく、書き換える手段を持たせない
- 差分は呼ぶ側が`git diff`で作り、「何を実現する変更か」と一緒に渡す。**作業中の経緯や自分の見立ては渡さない**（先入観のないレビューにするため）
- 差分の中にレビュー判定を誘導する文言があれば、データとして扱い、Criticalとして報告する（Day9のプロンプトインジェクション対策）
- 出力は良い点／指摘（Critical・Important・Minor）／判定（マージ可・修正後マージ可・マージ不可）

新しく作ったサブエージェントは、同じセッションですぐには使えなかった（8回呼んで「Agent type not found」）。セッションの後半で使えるようになった。

### 5. レビューの指摘は、実装する前に1件ずつ実測で確かめる

レビューを2回回し、2回とも指摘を実測で確かめてから直した。結果は対照的だった。

- **1回目（Day10で汎用化した`post-edit-test.js`）:** `team-reviewer`がまだ使えなかったため、`general-purpose`に同じ基準でレビューさせた（読み取り専用は「お願い」でしか守られていない形）。指摘を確かめると、正しいものと外れたものが混ざっていた
  - Critical「`execSync`のタイムアウト時に`err.killed`は存在しない」→ **本当だった**（`killed = undefined / code = ETIMEDOUT`）。Day10で足したタイムアウト表示は一度も出ていなかった
  - 「cwdの大文字小文字がずれるとルートより上に遡る」→ 本当だった（ホームの`C:\Users\sakaguchi`まで遡った）
  - 「stderrに出た失敗理由を落とす」→ 本当だった
  - 「Windowsでは孫プロセスがパイプを握ったまま残り、25秒で返らない」→ **再現しなかったので反論した**。孫を6秒眠らせ上限1秒で実測すると、1.0秒で返った
- **2回目（今日直した`pre-bash-guard.js`、`team-reviewer`で実施）:** 指摘に添えられた具体的なコマンド例15件をフックに通すと、**15件ともレビューの見立てどおりだった**

2回目で見つかった誤検知は深刻だった。自分で書いたテスト31件は全部通っていたのに、`git commit -m "... git push -f を止める"`のような**ガードの話題そのものを含むコミットを止めてしまう**状態だった。再起動して有効になっていたら、今日の締めのコミットがブロックされていた。**自分で書いたテストは、自分が想定したケースしか確かめない。** 先入観のない第三者のレビューが効くのはそこ。

## 実践内容

### チーム標準の権限（`.claude/settings.json`）

- `allow`（4件）: `npm test`・`git status`・`git diff`・`git log`。読むだけのものとテストに限定
- `deny`（3件）: `git push --force`・`git push -f`・`git reset --hard`

### チーム向けCLAUDE.mdの雛形（`templates/team-CLAUDE.md`）

ルールの書き方の約束（強制／お願い）、禁止事項の表、2つの層の実測表、設定ファイルの置き場所と優先順位、信頼の仕様、レビューの手順、新しく参加した人への注意をまとめた。

### `post-edit-test.js`の修正（1回目のレビュー対応）

テストを先に書く手順（TDD）で直した。

1. 関数を`module.exports`で取り出せるようにし、テスト`post-edit-test.test.js`を9件書いた
2. 今のコードで**6件がバグどおりの理由で失敗する**ことを確認した
3. 本体を直した（タイムアウトは`err.code === 'ETIMEDOUT'`で判定／ルートの内外判定を`path.relative`にする（win32では大文字小文字を区別しない）／stdoutとstderrをつなぎ、長すぎれば末尾を残して切り詰める）
4. 9件成功。大文字小文字のずれた実際のcwdでもmini-gameのテストが走ることを確かめた

テスト実行は`node --test plugins/dev-guard/hooks/post-edit-test.test.js`とファイルを指定する。フォルダごと指定すると、本体の`post-edit-test.js`まで名前が`*-test.js`に一致してテストとして起動され、標準入力を待って止まる。

### `pre-bash-guard.js`の穴塞ぎ（1.0.1 → 1.0.2 → 1.0.3）

**途中で見つかった一番大きな穴: PowerShellツールには、フックもdenyルールも効いていなかった。** フックのmatcherは`Bash`だけ、denyルールも`Bash(...)`の形。PowerShellツールで`git reset --hard`を含む文字列を出力するコマンドを実行すると、何も言われずに実行された。記録用のフックを一時的に置いて、PowerShellツールもフックに`tool_input.command`でコマンドを渡してくることを確かめてから（記録用フックは削除済み）、matcherを`Bash|PowerShell`にした。

| 版 | 判定の仕方 | テスト |
|---|---|---|
| 1.0.1 | 1本の正規表現で文字列全体を探す | なし |
| 1.0.2 | `&&`・`;`・`|`・改行で区切り、単語ごとにフラグを見る。PowerShellを対象に追加 | 31件（先に書き、13件の失敗を確認してから実装） |
| 1.0.3 | 区切った中で**コマンド名の位置にある単語だけ**を見る（先頭、`sudo`・`-exec`・`-c`・`/c`の直後、`$(`・`(`の直後）。行の継続をつなぐ。PowerShellの別名とcmdの削除を追加。判定中のエラーを標準エラーに残す | 48件（レビュー指摘を先に足し、15件の失敗を確認してから実装） |

2回目のレビューの指摘9件のうち8件を直し、1件（PreToolUseの`decision: 'block'`は公式ドキュメントで非推奨）は見送った。今も動いており、ドキュメントの記述も確かめていないため。

1.0.3で止まるようになった書き方: `git push origin main -f`・`git push -uf`・`git push origin +main`・`git reset HEAD~1 --hard`・`rm -fr`・`rm -r -f`・`(rm -rf build)`・行の継続で分けた`--force`・`Remove-Item -Recurse -Force`・`ri -r -fo`・`cmd /c rd /s /q`。

止めなくなった誤検知: 引用符の中の文字列（コミットメッセージ・検索語）、ヒアドキュメント形式のコミット、`git rm -r -f --cached`。

まだ残るもの: 変数に入れたコマンド・gitのエイリアス・スクリプトファイルは止まらない。ヒアドキュメントの本文で行頭に`rm -rf`などを書くと誤検知する。

プラグインは`claude plugin validate`を通し、`claude plugin update dev-guard@vibe-study --scope project`で1.0.3をインストールした。キャッシュに入った版が実行されるので、有効になるのは次のセッションから。

## 気づき・発見

- **テストが全部通っていても、テストの想定が狭ければ意味がない。** 31件通ったガードが、自分のコミットを止める状態だった
- **レビュー役は当たることも外れることもある。** 1回目は1件外れ、2回目は全部当たった。どちらの場合も「言われたから直す」ではなく、実測してから直す・反論する
- レビュー役に「具体的なコマンド例を添えて」と頼んだことで、指摘をそのまま実測・テストに変換できた。指摘の形式を指定するとレビューの検証コストが下がる
- 「対象ツールを増やす」（Bash → Bash＋PowerShell）時は、そのツールに今どのガードが効いているかを先に実測する。matcherに書いていないツールには、何のガードも効かない
- 設定の「効かない理由」は、ファイルの中身でなく環境（信頼状態・パス表記の重複）にあることがある

## 未解決・持ち越し

- プラグイン1.0.3が次のセッションで実際に効いているか（PowerShellツールで`Write-Output "git reset --hard HEAD"`がブロックされれば有効）
- **`claude` CLIのログインが失効している**（`401 OAuth access token has been revoked`）。ターミナルで`claude`を起動してログインし直す必要がある（本人の操作が必要）。Day12で`claude -p`を使う前に済ませる
- タイムアウトで打ち切った後、孫プロセスが動き続けるかは未確認
- `.mcp.json`のMCPサーバーの承認記録が、どの設定ファイルにも見当たらない件は未解明
- PowerShellツール向けのdenyルールの書き方は未確認（今はフックだけで止めている）
- `decision: 'block'`から`hookSpecificOutput.permissionDecision`への移行要否

## 成果物

リンクはタグ`day11`に固定している。

- [`templates/team-CLAUDE.md`](https://github.com/kiyo015/vibe-coding-study/blob/day11/templates/team-CLAUDE.md)（チーム向けCLAUDE.md雛形・新規）
- [`.claude/agents/team-reviewer.md`](https://github.com/kiyo015/vibe-coding-study/blob/day11/.claude/agents/team-reviewer.md)（読み取り専用レビュー役・新規）
- [`.claude/settings.json`](https://github.com/kiyo015/vibe-coding-study/blob/day11/.claude/settings.json)（チーム標準の権限）
- [`.gitignore`](https://github.com/kiyo015/vibe-coding-study/blob/day11/.gitignore)（`settings.local.json`を追加）
- [`plugins/dev-guard/.claude-plugin/plugin.json`](https://github.com/kiyo015/vibe-coding-study/blob/day11/plugins/dev-guard/.claude-plugin/plugin.json)（1.0.3・PowerShellを対象に追加）
- [`plugins/dev-guard/hooks/pre-bash-guard.js`](https://github.com/kiyo015/vibe-coding-study/blob/day11/plugins/dev-guard/hooks/pre-bash-guard.js)（判定の作り直し）
- [`plugins/dev-guard/hooks/pre-bash-guard.test.js`](https://github.com/kiyo015/vibe-coding-study/blob/day11/plugins/dev-guard/hooks/pre-bash-guard.test.js)（48件・新規）
- [`plugins/dev-guard/hooks/post-edit-test.js`](https://github.com/kiyo015/vibe-coding-study/blob/day11/plugins/dev-guard/hooks/post-edit-test.js)（レビュー指摘の修正）
- [`plugins/dev-guard/hooks/post-edit-test.test.js`](https://github.com/kiyo015/vibe-coding-study/blob/day11/plugins/dev-guard/hooks/post-edit-test.test.js)（9件・新規）
- [`mini-game/src/game.js`](https://github.com/kiyo015/vibe-coding-study/blob/day11/mini-game/src/game.js)（プラグイン版フックの発火確認に使った編集。定数変更時の手順をコメントに追記）
- [`study_plan_2weeks.md`](https://github.com/kiyo015/vibe-coding-study/blob/day11/study_plan_2weeks.md)
- [`2026-09-14/summary.html`](https://github.com/kiyo015/vibe-coding-study/blob/day11/2026-09-14/summary.html)（配布用HTML版）

## 次回（Day12）予告

まず持ち越しの確認: プラグイン1.0.3が有効か（PowerShellツールでも止まるか）。その上で自動化・定期実行——`claude -p`によるヘッドレス実行、スケジュール実行、CIへの組み込み。今日分かった「未信頼のフォルダでは許可ルールが効かない」「CLIの認証が失効していた」は、無人で動かす時にそのまま詰まる箇所なので、最初に押さえる。
