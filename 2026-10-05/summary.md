# Day23 学習記録（2026-10-05）— アナライザで強制にする

基幹システム開発計画の9日目。「金額に `double`・`float` を使わない」「端数処理は `Money` の中だけ」の2つを、書いてあるだけの**お願い**から、ビルドで止める**強制**に変えた。途中で、**最新版のアナライザが黙って無効になる**ことと、**BannedApiAnalyzers では型の宣言とキャストを止められない**ことを実測で見つけ、両方に手当てをした。

## 今日行った処理

### 1. Day22 からの持ち越し2件

**決めごと4点の確認**: 本人に4問で確認し、すべて推奨どおりで確定した。

| 決めごと | 結果 |
|---|---|
| 返品しても受注の状態と出荷済み数量は戻さない | 確定 |
| 返品した数量は同じ受注で出荷し直せない | 確定 |
| 出荷指示だけでは数量を押さえない | 確定 |
| 確定した出荷は取り消せない。返品の売上日は返品日 | 確定 |

業務ルール集の見出しに「2026-10-02 決定・2026-10-05 本人確認」と書いた。

**テストの実行時間**: PCの負荷は Claude アプリ自体で 30〜100% を行き来し、下がりきらなかった。そこで全体の時間ではなく、**テスト1件ごとの所要時間**を単独で3回ずつ測って比べた。

| テスト | 所要時間（3回） |
|---|---|
| Day22 のランダムな出荷と返品 1万件 | 2.1・3.3・3.5秒 |
| Day21 のランダムな請求書 1万件 | 0.8・1.4・1.5秒 |

増分は約2〜3秒。`dev-guard` が編集のたびに走らせても許容できるので、件数は据え置いた。

### 2. まず「今は何も止めていない」ことを確かめた

違反を22箇所並べた一時ファイルを Domain に置いてビルドした。`double`・`float` の宣言、`Math.Round`・`decimal.Round` の全形、`Floor`・`Ceiling`・`Truncate`、`Convert.ToInt32/64`、`(long)` などのキャスト。

結果は**警告0・エラー0でビルド成功**。お願いのままでは、何も止まらない。

### 3. 最新版のアナライザは、黙って無効になった

| 構成 | 違反22箇所を入れたビルド |
|---|---|
| アナライザなし | 成功（警告0） |
| **BannedApiAnalyzers 5.6.0（最新）** | **成功**。警告 CS9057 が1件出るだけ |
| 5.6.0 ＋ CS9057 をエラーに | CS9057 で失敗 |
| BannedApiAnalyzers 3.3.4 | RS0030 で失敗（17件） |

CS9057 の中身は「アナライザがコンパイラ 4.12 を参照している。実行中は 4.11」。SDK 8.0.421 のコンパイラより新しいアナライザは読み込まれず、**何も検査しないままビルドが通る**。警告は1件だけで、ほかの出力に紛れる。

手当ては2つ。

- **3.3.4 に固定した。** SDK を上げるときに一緒に上げる
- **CS9057 をエラーにした。** 将来だれかが版を上げても、黙って無効になることが無くなる（5.6.0 で失敗することを確認）

### 4. 3.3.4 でも素通りした5箇所

| 番号 | 書き方 | 3.3.4 の結果 |
|---|---|---|
| 01 | `double price = 1.5;` | **素通り** |
| 02 | `float rate = 0.1f;` | **素通り** |
| 03 | `(double)amount` | **素通り** |
| 04〜19 | `Math.Round`・`decimal.Round` の全形、`Floor`・`Ceiling`・`Truncate`、`Convert.ToInt32/64` | RS0030 |
| 20・21 | `(long)amount`・`(int)amount` | **素通り** |
| 22 | `Math.Round(price)`（double の丸め） | RS0030 |

BannedApiAnalyzers は、APIの呼び出しを見る道具で、**型名の宣言とキャストは検査の対象外**だった。禁止リストに `T:System.Double` を書いても、`double x` は止まらない。

そこで、コンパイルの前にソースの文字列を調べる検査を MSBuild に足した（`src/Directory.Build.props`）。

| コード | 止めるもの |
|---|---|
| SALES001 | `src` のソースに `double`・`float`・`Double`・`System.Single` の語がある |
| SALES002 | `Money.cs` 以外で RS0030 を抑止している（`#pragma`・`SuppressMessage`・`NoWarn`） |

SALES002 は計画に無かったが、「強制」と書くための前提として足した。抑止が自由なら、エラーが出た人が1行足して黙らせられる。

### 5. 既存のコードも6箇所が引っかかった

| ファイル | 中身 | 対処 |
|---|---|---|
| `Money.cs` 3箇所 | 丸めと、円単位の確認・正規化 | 丸めと正規化の2箇所だけ `#pragma` で許可。確認は `yen % 1m != 0m` に |
| `SalesOrderLine.cs` 2箇所・`TaxRate.cs` 1箇所 | 桁数の検査（小数2桁・3桁まで）の `decimal.Truncate` | `x * 100m % 1m != 0m` に書き換え |

桁数の検査は端数処理ではないが、`Truncate` を許すと抜け道になるので、別の書き方に替えた。既存のテスト（範囲外の税率、小数4桁の数量など）で動作が変わらないことを確かめた。

### 6. 対照実験：違反を1種類ずつ入れてビルドした

| ケース | 入れた違反 | 結果 |
|---|---|---|
| C0 | なし（基準） | 成功 |
| C1 | Domain で `Math.Round` など6種 | RS0030 6件で失敗 |
| C2 | Domain で `double` の宣言 | SALES001 で失敗 |
| C3 | Domain で `(float)` へのキャスト | SALES001 で失敗 |
| C4 | `Money.cs` 以外で `#pragma warning disable RS0030` | SALES002 で失敗 |
| C5 | `Money.cs` 以外で `SuppressMessage("…", "RS0030")` | SALES002 で失敗 |
| C6 | csproj の `NoWarn` に RS0030 | SALES002 で失敗 |
| C7 | Api プロジェクトで `Math.Round` | RS0030 で失敗 |
| C8 | Infrastructure プロジェクトで `double` | SALES001 で失敗 |
| C9 | `var price = 1.5` と `(long)amount`（既知の穴） | **成功（止まらない）** |

C7・C8 で、`src` 配下の全プロジェクトに効くことも確かめた。`tests` 配下には効かない（テストは期待値を `long` などの別の方法で出すため）。

C9 は穴として残した。文字列の検査では、型名を書かない `double`（`var x = 1.5`、`Math.Sqrt` の戻り値）と、キャストによる切り捨ては見つけられない。CLAUDE.md に「レビューで拾う」と明記した。正確に止めるには、型を調べる自前のアナライザが要る。

### 7. 文書を更新した

- **CLAUDE.md**: 禁止事項の2行を「お願い」から「強制（ビルド）＋お願い」に変え、止まらない書き方も書いた。「金額のきまりをビルドで止める仕組み」の節を足した（落ちたら抑止せず `Money` で書き直す、3.3.4 に固定している理由）
- **業務ルール集**: 端数処理の「Day23でアナライザによる強制にする」を、「2026-10-05からビルドで強制している」に変えた

### 8. 最終確認

ソリューション全体のビルドはエラー0（警告1件は既存の MSB3277。EF Core の版の競合で、今日の変更とは無関係）。テストは Domain 104件・結合 6件すべて成功。

## 今日学んだこと

### 「入れた」は「効いている」ではない

最新版のアナライザを入れた時点で、ビルドは通り、警告は1件だけだった。違反を入れて落ちることを確かめなければ、「強制にした」と記録していた。安全柵は、**止まるべきものを入れて、止まるのを見る**まで効いているとは言えない。Day17 の dev-guard の対照実験と同じ教訓を、ビルドの設定でも繰り返した。

### 黙って無効になる警告は、エラーにする

CS9057 は「この道具は今動いていない」という知らせなのに、警告の扱いだった。安全柵が外れたことを知らせる警告は、エラーに格上げしておく。

### 道具が何を見ていて、何を見ていないかを測る

BannedApiAnalyzers は API の呼び出しを見るが、型の宣言とキャストは見ない。名前から「禁止したものは全部止まる」と思い込んでいた。違反を種類ごとに並べたことで、止まらない5箇所がはっきりした。

### 強制には、抜け道を塞ぐところまで含める

エラーが出たときに1行で黙らせられるなら、強制ではない。抑止してよい場所（`Money.cs`）を決め、それ以外での抑止をビルドで止めた。

### 止められない穴は、穴として書く

文字列の検査で止められない書き方（C9）は、実測したうえで CLAUDE.md に書いた。「強制」と書くなら、どこまでが強制かも書く。

## つまずき

### 対照実験の書き戻しで、csproj の BOM が外れた

**症状** — `NoWarn` を入れて戻したはずの csproj が、git で「変更あり」になった。

**原因** — ファイルを文字列として読み、UTF-8（BOM なし）で書き戻したので、先頭の BOM が外れた。

**対策** — git で元に戻し、スクリプトをバイト列のまま退避・復元する形に直した。直した版でもう一度実行し、結果が同じで差分が出ないことを確かめた。

## 気づき・発見

- Day24 の model 比較では「わざと端数処理の誤りを仕込んだ差分」をレビューさせる予定。`Math.Round` などは今日からビルドで止まるので、**仕込む誤りはビルドで止まらないもの**（明細ごとに税を丸める、`(long)` で切り捨てる、`var` で double を使う等）にする必要がある

## 成果物

### sales-core（製品コード）

- [src/Directory.Build.props](https://github.com/kiyo015/sales-core/blob/day23/src/Directory.Build.props) — アナライザ 3.3.4、RS0030・CS9057 をエラーに、SALES001・002 の検査
- [src/BannedSymbols.txt](https://github.com/kiyo015/sales-core/blob/day23/src/BannedSymbols.txt) — 禁止する24項目と理由
- [src/SalesCore.Domain/Money.cs](https://github.com/kiyo015/sales-core/blob/day23/src/SalesCore.Domain/Money.cs) — 丸めの2箇所だけ `#pragma` で許可
- [src/SalesCore.Domain/TaxRate.cs](https://github.com/kiyo015/sales-core/blob/day23/src/SalesCore.Domain/TaxRate.cs) ／ [SalesOrderLine.cs](https://github.com/kiyo015/sales-core/blob/day23/src/SalesCore.Domain/SalesOrderLine.cs) — 桁数の検査を `% 1m` に
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day23/CLAUDE.md) — 禁止事項2行を強制に、仕組みの節を追加
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day23/docs/domain/business-rules.md) — 端数処理の強制、Day22 の決めごとの本人確認

### Study（学習記録）

- [evidence/2026-10-05-analyzer-probe.txt](https://github.com/kiyo015/vibe-coding-study/blob/day23/evidence/2026-10-05-analyzer-probe.txt) — 違反22箇所の実験と、版の比較
- [evidence/2026-10-05-analyzer-cases.txt](https://github.com/kiyo015/vibe-coding-study/blob/day23/evidence/2026-10-05-analyzer-cases.txt) — 対照実験10ケースの結果
- [evidence/2026-10-05-analyzer-cases.ps1](https://github.com/kiyo015/vibe-coding-study/blob/day23/evidence/2026-10-05-analyzer-cases.ps1) — 対照実験のスクリプト
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day23/study_plan_next_month.md) — Day23 の実測値
- [2026-10-05/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day23/2026-10-05/summary.md) — この記録
- [2026-10-05/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day23/2026-10-05/summary.html) — 配布用HTML

## 付録：設定と検証の中身

スクリプト本体はメールに添付しない（`.ps1` は危険な添付と扱われる）。設定の要点と結果をここに載せる。

### ビルドで止める設定（`src/Directory.Build.props` の要点）

```xml
<PackageReference Include="Microsoft.CodeAnalysis.BannedApiAnalyzers" Version="3.3.4" PrivateAssets="all" />
<AdditionalFiles Include="$(MSBuildThisFileDirectory)BannedSymbols.txt" />
<WarningsAsErrors>$(WarningsAsErrors);RS0030;CS9057</WarningsAsErrors>

<!-- コンパイルの前に、ソースの文字列を調べる -->
<_FloatingPoint Include="@(Compile)" Condition="…Regex.IsMatch(ファイルの中身, '\b(double|float|Double)\b|\bSystem\.Single\b')" />
<_RoundingSuppressed Include="@(Compile)" Condition="ファイル名が Money.cs 以外 and 中身に 'RS0030' を含む" />
<Error … Code="SALES001" Text="double・float を使っている。…" />
<Error … Code="SALES002" Text="RS0030 を抑止している。抑止してよいのは Money.cs だけ。…" />
<Error Condition="NoWarn に RS0030 か CS9057" Code="SALES002" … />
```

### 禁止リスト（`src/BannedSymbols.txt`、24項目の内訳）

```
Math.Round(decimal ・ double)        8形   端数処理は Money.Round で行う
decimal.Round(decimal)               4形   同上。指定しないと銀行丸めになる
Math/decimal の Floor・Ceiling・Truncate 6形   切り捨て・切り上げは業務ルールに無い
Convert.ToInt32/ToInt64(decimal)     2形   銀行丸めで整数にする
decimal から int・long へのキャスト  2形   （登録したが、3.3.4 はキャストを検査しなかった）
型 Double・Single                    2形   （登録したが、宣言は検査しなかった → SALES001 で止める）
```

### CS9057 の全文（5.6.0 のとき）

```
CSC : warning CS9057: アナライザー アセンブリ '…\bannedapianalyzers\5.6.0\…BannedApiAnalyzers.dll' は、
コンパイラのバージョン '4.12.0.0' を参照しています。これは、現在実行中のバージョン '4.11.0.0' よりも新しいバージョンです。
```

### 対照実験10ケースの出力

```
C0-baseline-no-violation: exit 0 -> no errors
C1-rounding-api-in-domain: exit 1 -> RS0030 ×6
C2-double-in-domain: exit 1 -> SALES001
C3-float-cast-in-domain: exit 1 -> SALES001
C4-pragma-outside-money: exit 1 -> SALES002
C5-suppressmessage-outside-money: exit 1 -> SALES002
C6-nowarn-in-csproj: exit 1 -> SALES002
C7-rounding-api-in-api-project: exit 1 -> RS0030
C8-double-in-infrastructure: exit 1 -> SALES001
C9-known-gap-var-double-and-long-cast: exit 0 -> no errors
```

## 次回予告

**Day24 — ルール変更手順のスキル化とレビュー役の強化**

- `domain-rule-change` スキル: 税率・端数処理・締め日を変えるときに、コード・テスト・`docs/domain/` を必ず一緒に直す手順
- `team-reviewer` の観点に「金額の型と端数処理」「状態遷移」「取消と削除」「秘密情報」を追加
- model 比較: わざと誤りを仕込んだ差分を haiku／sonnet／opus にレビューさせ、検出数・誤検知・費用・時間を表にする。**仕込む誤りは、今日からビルドで止まるもの以外にする**

**完了条件:** 比較表ができ、実測に基づいてレビュー役の `model` を決めている

**持ち越し:** なし。今日の費用は0。
