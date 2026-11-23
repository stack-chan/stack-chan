# sanoTTS-jp Model License 1.0

`SPDX-License-Identifier: LicenseRef-sanoTTS-jp-Model-1.0`

**Copyright (c) 2026 ayutaz** — 本ライセンスにおける**許諾者**（licensor）。

⚠️ **この表示が及ぶのは、本モデルの重みのうち許諾者が権利を持つ部分だけ**です。
**素材の著作権は各権利者に留保されます**（つくよみちゃんコーパス = © 夢前黎 /
LibriTTS-R / CML-TTS / AISHELL-3 / Open JTalk / NAIST-JDIC。§3.1 と
[`NOTICE.md`](NOTICE.md) を参照）。
⚠️ **同梱の [`LICENSE-APACHE-2.0.txt`](LICENSE-APACHE-2.0.txt) は改変しません** —
あれは AISHELL-3 の Apache-2.0 §4(a) を満たすための**ライセンス全文そのもの**で、
末尾の `Copyright [yyyy] [name of copyright owner]` は
**APPENDIX（使う人向けの雛形）**であって本配布物の著作権表示ではありません。

*[English below](#english)*

---

## ⚠️ このファイルが必要な理由

**リポジトリの [`LICENSE`](LICENSE)（MIT）は、配布されるモデルの重みには適用されません。**

MIT は「無制限に (without restriction)」の利用を認めます。しかしこのモデルの重みは
**つくよみちゃんコーパス**を素材に含む教師モデルからの蒸留物であり、そのコーパスの条件は

- **帰属表示を必須**とし、
- **出力の用途に禁止事項**を課し、
- **その義務が再配布を受けた側にも伝播する**

と定めています。したがって **MIT を名乗ることは、こちらが持っていない権利を
持っているかのように宣言すること**になります。そこで重みだけを別条件で配布します。

| 対象 | ライセンス |
|---|---|
| このリポジトリの**コードとドキュメント** | [MIT](LICENSE) |
| **配布されるモデルの重み**（下記「1. 適用範囲」） | **このファイル** |

---

## 1. 適用範囲

本ライセンスは、GitHub Release で配布される次の成果物（以下「本モデル」）に適用されます。

⚠️ **版（`v3` / `v4`）を問いません。** `N` は配布された版を指します。

| ファイル | 内容 |
|---|---|
| `saanotts-jp-vN-stage4.pt` | PyTorch checkpoint（fp32、3 つの生徒モデル） |
| `saanotts-jp-vN-int8.bin` | C99 コア用 int8 重みブロブ（SAAN 形式。v0.2.0 の資産は v1、2026-09-02 以降のコアは v2 を読む） |
| `saanotts-jp-vN-fp32.bin` | 同 fp32 版 |
| `golden-vN-fp32.bin` / `golden-vN-int8.bin` | 移植検証用のゴールデン中間出力 |
| `saanotts-jp-vN-samples.zip` / `samples/*.wav` | 本モデルが生成した音声サンプル |
| `esp32s3-firmware-*.bin` | **重みを含む** ESP32-S3 用の flash イメージ（v0.1.1 以降） |
| **`m5-cores3-firmware-*.bin`** | 同上（M5Stack CoreS3 向け。**`.rodata` に重みを埋め込む**） |

⚠️ **辞書だけの資産（`k1-dict-*.bin`）には本ライセンスは適用されません。**
あれは NAIST-JDIC の派生物で、条件は [`NOTICE.md`](NOTICE.md) の辞書の節に従います
（**本モデルの重みを 1 バイトも含みません**）。

本モデルから派生したもの（ファインチューン、量子化、変換、蒸留の結果を含む）、
および**本モデルが生成した音声**にも、本ライセンスの条件が及びます。

⚠️ **自分でビルドした firmware にも重みが入ります。** `esp32/` も
`esp32/boards/m5unified/`（M5Stack）も、int8 blob を**パーティションまたは `.rodata`**
としてイメージに埋め込みます。配布するなら §3 の義務に加えて、
[`NOTICE.md`](NOTICE.md) の第三者コード（Open JTalk / M5Unified / M5GFX / IPA フォント /
辞書）の表示も要ります。

## 2. 許諾

上記の条件に従う限り、**無償で**、次のことを行えます。

- 使用（**商用利用を含む**）
- 複製・改変・派生物の作成
- 再配布・サブライセンス

## 3. 条件

### 3.1 帰属表示

本モデルまたはその派生物を再配布する場合、下記 **(A)** を**そのまま**、
配布物の `NOTICE` / `README` / クレジット表示のいずれかに含めてください。

⚠️ **例外は 1 行だけ**: **JSUT の行は、v4 系の重みを配る場合には含めません**
（その重みは JSUT を 1 行も使っていないため。詳細は (A) の直後）。
**それ以外の行は 1 つも省かないでください。**

⚠️ **2026-09-09 に (A) と (B) に分けた。** それまでは全体を 1 ブロックにして
「1 行でも欠けると違反」と書いていたが、**3 件が誤っていた**（[`docs/decisions.md`](docs/decisions.md) C-073）:

- **帰属を要求する 3 素材が抜けていた** — LibriTTS-R / CML-TTS（CC-BY-4.0）と AISHELL-3（Apache-2.0）
- **帰属を要求しない素材が「必須」に入っていた** — MOE-Speech はライセンス本文で
  「クレジット表記は必要ありません」と明記している。CC0 / パブリックドメインの素材も同様
- **ITA コーパスを `CC0-1.0` と書いていた** — 一次ソースは「パブリックドメインです」で、
  CC0 の付与ではない

#### (A) 必須 — 欠くと対応する素材の条件に違反します

```
This model was distilled from a piper-plus teacher model.
sanoTTS-jp — https://github.com/ayutaz/sanoTTS-jp

つくよみちゃんコーパス
  本ソフトウェアの音声合成には、フリー素材キャラクター「つくよみちゃん」
  （© 夢前黎）が無料公開している音声データを使用しています。
  https://tyc.rei-yumesaki.net/material/corpus/

教師 base の学習に使用した音声コーパス
（⚠️ 改変あり: いずれも音声合成モデルの学習に使用しています）:
  - LibriTTS-R (en) — Koizumi et al., 2023 — CC BY 4.0
      素材:       https://www.openslr.org/141/
      ライセンス: https://creativecommons.org/licenses/by/4.0/
  - CML-TTS (es / fr / pt) — freds0 et al. — CC BY 4.0
      素材:       https://github.com/freds0/CML-TTS-Dataset
      ライセンス: https://creativecommons.org/licenses/by/4.0/
  - AISHELL-3 (zh) — Shi et al., 2020 — Apache-2.0
      素材:       https://www.aishelltech.com/aishell_3
      ライセンス: https://www.apache.org/licenses/LICENSE-2.0
  上記 3 素材は現状のまま (AS IS) 提供され、明示・黙示を問わず保証はありません。

蒸留に使用したテキストコーパス:
  - JSUT ver1.1 (高道慎之介) — CC-BY-SA-4.0 ほか（subset 別）
      https://sites.google.com/site/shinnosuketakamichi/publication/jsut
      ライセンス: https://creativecommons.org/licenses/by-sa/4.0/
      ⚠️ **v4 以降の重みでは不要**（下記）
```

⚠️ **JSUT の行は「どの重みを配るか」で要否が変わります。**

| 配布する重み | JSUT の行 | 理由 |
|---|---|---|
| **v4 系**（`saanotts-jp-v4-*` = **`v1.0.0` で配っている現行版**） | **不要** | 蒸留テキストが CC0 / PD のみ（[`docs/decisions.md`](docs/decisions.md) D-057 / D-054） |
| **v3 系**（`saanotts-jp-v3-*` = `v0.1.0`〜`v0.3.1`。**今もダウンロードできる**） | **必須** | 蒸留テキストに JSUT 6,380 行を含む |

⚠️ **どちらの資産も今ダウンロードできるので、この 2 行は同時に真である。**
**自分が配る重みがどちらかを確認してから**、その行を含める / 含めないを決めること。
⚠️ **JSUT を外しても、(A) の他の項目と §3.2 の用途制限は 1 つも減らない**
（それらは つくよみちゃんコーパスと教師 base 由来）。

⚠️ **原典に明示の著作権表示が無い素材は、著作者名で代えています**
（CC BY 4.0 §3(a)(1)(A) は copyright notice を求めるが、原典が公開していない）。
**著作権表示を創作して書くことはしません。**

⚠️ **AISHELL-3（Apache-2.0）には、(A) をそのまま写しても満たせない義務が残ります。**
(A) が示しているのは `https://www.apache.org/licenses/LICENSE-2.0` という**リンクだけ**で、
Apache License, Version 2.0 §4(a) が求める**ライセンス全文の同梱**そのものではありません。
AISHELL-3 由来の素材を含む本モデルを再配布する場合は、(A) に加えて
**Apache-2.0 の全文を別途配布物に同梱してください**（例: `NOTICE` と同じ場所に
`LICENSE-APACHE-2.0.txt` を置く）。
✅ **その全文はこのリポジトリの [`LICENSE-APACHE-2.0.txt`](LICENSE-APACHE-2.0.txt) に在る**
（原典 `https://www.apache.org/licenses/LICENSE-2.0.txt` / sha256 `cfc7749b96f63bd3…` /
202 行 11,358 B）。
⚠️ **v0.3.0 / v0.3.1 の資産には入っていない**（[`docs/decisions.md`](docs/decisions.md) C-081）。
❌ **それを差し替えないと決めた**（同 D-061）ので、**v0.3.x を再配布する方は
このファイルを自分で足してください。**
§6 の表にある「§4: ライセンス全文の同梱と通知の保持」は
この追加の一手間を指しており、(A) を写すだけでは discharge されません。

#### (B) 任意 — 出所の記録（**帰属義務はありません**）

```
MOE-Speech (litagin) — https://huggingface.co/spaces/litagin/moe-speech-license
  教師 base の日本語。著作権法 30 条の 4（情報解析のための利用）に基づき学習に使用。
  ⚠️ このライセンスは「クレジット表記は必要ありません」と明記しています。

蒸留に使用した CC0 / パブリックドメインのテキスト:
  - Common Voice ja (Mozilla) — CC0-1.0
      https://github.com/common-voice/common-voice
  - ROHAN4600 (森勢将雅) — CC0-1.0（パブリックドメイン）
      https://github.com/mmorise/rohan4600
  - ITA コーパス (小口純矢ほか) — パブリックドメイン
      https://github.com/mmorise/ita-corpus

教師実装: piper-plus (MIT) — https://github.com/ayutaz/piper-plus
```

⚠️ **(B) を落としても違反にはなりませんが、残すことを勧めます。**
CC0 は帰属を放棄していますが、**出所が追えなくなると (A) の正しさも検証できなくなります。**

⚠️ **(A) の 3 素材が本モデルに届くのは「モデルは学習音声の翻案物である」という立場を
取ったときだけです。** 本プロジェクトは著作権法 30 条の 4 によりその立場は通りにくいと
判断していますが（§5）、**過剰に帰属して違反になることはない**ため (A) に入れています
（[`docs/decisions.md`](docs/decisions.md) D-055）。

### 3.2 出力の用途制限（必須・伝播する）

つくよみちゃんコーパスの条件により、**本モデルが生成した音声**は次に使えません。

**一次ソースの原文をそのまま引く**（要約すると条件節が落ちる。[`docs/decisions.md`](docs/decisions.md) C-072）:

> 【禁止事項】
> ■人を批判・攻撃すること。（「批判・攻撃」の定義は、つくよみちゃんキャラクターライセンスに準じます）
> ■特定の政治的立場・宗教・思想への賛同または反対を呼びかけること。
> ■刺激の強い表現をゾーニングなしで公開すること。
> ■他者に対して二次利用（素材としての利用）を許可する形で公開すること。

⚠️ **上の引用に強調は入れていない。** かつて 3・4 行目に `**` を足していたが、
**原文には無い**。「原文をそのまま引く」と書いた引用に自分の強調を混ぜると、
**提供元がそこを強調したように読める**（[`docs/decisions.md`](docs/decisions.md) C-084）。
**落としやすいのは 3・4 行目の条件節**である（「ゾーニングなしで」「許可する形で」）
— これは**私たちの注意書き**であって、原文の強調ではない。

⚠️ **2026-09-09 に訂正した。** それまで 3 行目を「❌ **アダルト用途**」、
4 行目を「❌ 素材としての再配布」と書いていたが、**どちらも一次ソースより厳しく、誤り**だった。
提供元は逆のことを明言している:

> つくよみちゃんプロジェクトは、表現の自由を尊重しています。
> 適切なゾーニングが実施されている限りにおいては、成人向け表現や残酷な表現についても
> 制限を設けておりません。

> ※鑑賞用の作品として配布・販売していただくことは問題ございません。

⚠️ **この 2 つの引用にも強調は入れていない**（同じ理由。[`docs/decisions.md`](docs/decisions.md) C-084）。

つまり **成人向け表現そのものは禁止されておらず、ゾーニングしない公開が禁止**されている。
「素材としての再配布」も、禁止は**他者に二次利用を許可する形での公開**であって、
作品そのものの配布・販売ではない。

⚠️ ただし一次ソースには別途「■本品の声質を用いて合成された音声を、素材として
配布・販売することも、**原則的には**禁止です」ともある。
**「原則的には」の含みは本プロジェクトでは判断していない。** 素材配布を予定するなら
提供元に確認すること。

**この 4 項目を利用規約として課すことが義務である**（一次ソース:
「音声合成ソフトの利用規約において、出力した音声を次の目的で使用することを
禁止しない場合は、**事前にご相談ください**」）。

✅ **ただしエンドユーザーへのクレジットは義務ではない**（一次ソース:
「音声合成ソフトのユーザーに対して、ソフト使用時にクレジットを義務付けるかどうかは
**あなたの自由**です」/「**音声合成ソフトから出力された音声にはクレジットの義務は
発生しません**」）。§3.1 (A) が義務づけるのは**再配布する者**に対してである。

一次ソース: <https://tyc.rei-yumesaki.net/material/corpus/>
（**条件は提供元が更新しうるため、配布・利用の前に一次ソースを確認してください。
一次ソースと本ファイルが食い違う場合、一次ソースが優先します。**）

### 3.3 条件の伝播（必須）

本モデルまたはその派生物を第三者に配布する場合、**3.1 と 3.2 を第三者にも課して
ください**。これらの義務を外して配布することはできません。

### 3.4 やってはいけない表示

- ❌ 本モデルを **MIT / Apache-2.0 / CC0 など無制限のライセンスで再配布すること**
- ❌ つくよみちゃん（© 夢前黎）が本プロジェクトを推奨・承認していると示唆すること
- ❌ 本モデルを arXiv:2608.21378 の**著者らによる公式実装**であると示唆すること
  （本リポジトリは論文からの独立再実装です。[`NOTICE.md`](NOTICE.md) 参照）

## 4. 無保証・免責

本モデルは **現状のまま (AS IS)** 提供され、明示・黙示を問わずいかなる保証もありません。
商品性・特定目的適合性・権利非侵害の保証を含みますが、これらに限りません。
本モデルの使用または使用不能から生じたいかなる損害についても、
著作権者および提供者は責任を負いません。

⚠️ **本モデルは検証 (PoC) の成果物であり、製品品質ではありません。**
既知の制約は [`MODEL_CARD.md`](MODEL_CARD.md) を参照してください。

## 5. 既知の法的リスク（隠さずに書きます）

⚠️ 蒸留に使ったテキストのうち **JSUT ver1.1 の 6,380 行は CC-BY-SA-4.0**（継承付き）です。
（**6,472 は `data/splits/corpus_train.tsv` の生の JSUT 行数**。うち 92 uid は教師の
FT テキストとの重複除外 B-10 で既に外れているので、実際に蒸留に使われたのは
6,472 − 92 = **6,380**。再現:
`awk -F'\t' '$1 ~ /^jsut\// {print $2}' data/splits/corpus_train.tsv | sort -u > /tmp/a;
grep -v '^#' data/splits/exclusions_teacher_ft.txt | cut -f1 | sort -u > /tmp/b;
comm -12 /tmp/a /tmp/b | wc -l` → 92）

「学習済みモデルは学習テキストの二次的著作物である」という立場を取られた場合、
本モデルにも CC-BY-SA の継承が及ぶ可能性があります。本プロジェクトは

- 日本の著作権法 **30 条の 4**（情報解析のための利用）により学習自体が許されること
- **コーパス本文を再配布していない**こと

から実務上この立場が通る公算は低いと判断しましたが、**リスクはゼロではありません**
（[`docs/decisions.md`](docs/decisions.md) D-035）。

### ✅ v4 でこのリスクは消える（⚠️ **v4 はまだ配布していない**）

2026-09-10 に、**JSUT を外した v4 を学習して受け入れた**
（[`docs/decisions.md`](docs/decisions.md) D-057）。蒸留テキストは **CC0 / パブリックドメインのみ**
（14,513 行。論文の 14,343 行を上回る）で、**継承付きの素材を 1 行も含まない。**

| | v3（`v0.1.0`〜`v0.3.1`。**今もダウンロードできる**） | v4（**`v1.0.0` 以降で配っている現行版** = D-059） |
|---|---:|---:|
| JSUT ver1.1 | 6,380 行 | **0 行** |
| 継承（share-alike）リスク | ⚠️ **本節のとおり残る** | **無し** |
| 品質（SCOREQ 教師比） | 0.6444 | 0.6361（**差は検出できず**） |

⚠️ **本節は v3 についてのものである。** ✅ **現行版（v4 / `v1.0.0`）にこのリスクは無い。**
⚠️ ただし **v3 の資産は今もダウンロードでき、それを使う限りこのリスクは残る。**
⚠️ **v4 でも §3.2 の出力用途制限と §3.3 の伝播は 1 つも減らない**
（つくよみちゃんコーパス由来）。**消えるのは蒸留テキストの継承リスクだけ。**

⚠️ **2026-09-10、教師の声は つくよみちゃんのままにすると決めた**
（[`docs/decisions.md`](docs/decisions.md) D-058）。**したがって §3.2 の出力用途制限 4 項目と
§3.3 の伝播は、今後の版でも残る** — 「将来の版で消える」ものとして扱わないこと。
⚠️ **本モデルを製品に組み込む場合、§3.2 の 4 項目を自社の利用規約に書く義務がある。**

⚠️ **本節を含む本ファイルの法的評価は、本プロジェクトによる一次ソースの読解であり、
弁護士による法的助言ではありません。** 重要な用途に使う場合はご自身で確認してください。

## 6. 上流の条件（要約）

**義務の根拠は 2 種類ある。混ぜて考えると判断を誤る。**

| 根拠 | 意味 | 該当 |
|---|---|---|
| **契約** | 素材の提供条件を受諾した。**モデルが翻案物かに関係なく届く** | つくよみちゃん / MOE-Speech |
| **著作権** | Licensed Material の翻案物に対する条件。**「モデルは学習素材の翻案物か」次第**（§5） | LibriTTS-R / CML-TTS / AISHELL-3 / JSUT |

| 素材 | 経路 | 根拠 | 条件 | §3.1 |
|---|---|---|---|---|
| つくよみちゃんコーパス（© 夢前黎） | 教師の fine-tune（100 発話） | 契約 | 30 条の 4 ベースの独自ライセンス。**モデル配布は明示的に許可**。帰属必須・出力に禁止用途・義務が伝播 | **(A)** |
| **LibriTTS-R** (en) | 教師 base の学習音声 | 著作権 | **CC-BY-4.0 = 帰属必須**（⚠️ 継承は無い） | **(A)** |
| **CML-TTS** (es/fr/pt) | 同 | 著作権 | **CC-BY-4.0 = 帰属必須** | **(A)** |
| **AISHELL-3** (zh) | 同 | 著作権 | **Apache-2.0 = 帰属必須。§4 はさらに全文同梱を求める**（⚠️ (A) はリンクのみ。§3.1 参照） | **(A)** |
| JSUT ver1.1 | 蒸留テキスト | 著作権 | CC-BY-SA-4.0 ほか（**唯一の継承付き**。§5） | **(A)** |
| MOE-Speech (litagin) | 教師 base の日本語 | 契約 | 30 条の 4 ベース。**モデルの公開は再配布とみなさない / クレジット不要**と明記 | (B) |
| Common Voice ja / ROHAN4600 | 蒸留テキスト | — | CC0-1.0（帰属は放棄されている） | (B) |
| ITA コーパス | 蒸留テキスト | — | **パブリックドメイン**（⚠️ CC0 の付与ではない） | (B) |
| piper-plus | 教師の実装 | — | MIT（重みにはコードを含まないので任意） | (B) |

⚠️ **CC-BY-4.0 は翻案物を制限的な条件で配ることを禁じていない。**
§2(a)(5)(ii) の「追加の条件を課してはならない」は "**the Licensed Material**"（元の素材）
だけを対象としており、翻案物への条件は §3(a)(4)（受取人が CC-BY を遵守できることを
妨げない）だけが制約する。**したがって §3.1 (A) の帰属と §3.2 の用途制限は両立する**
（⚠️ 一度「衝突する」と記録したが誤りだった。[`docs/decisions.md`](docs/decisions.md) C-074）。

詳細と一次ソースは [`NOTICE.md`](NOTICE.md) と
`docs/decisions.md` の D-054〜D-058 にあります。

---

<a name="english"></a>

# English

**Copyright (c) 2026 ayutaz** — the **licensor** under this license.

⚠️ **This notice covers only the parts of the weights in which the licensor holds
rights.** Copyright in the source materials remains with their respective holders
(Tsukuyomi-chan Corpus © Rei Yumesaki; LibriTTS-R; CML-TTS; AISHELL-3; Open JTalk;
NAIST-JDIC — see §3.1 and [`NOTICE.md`](NOTICE.md)).
⚠️ **The bundled [`LICENSE-APACHE-2.0.txt`](LICENSE-APACHE-2.0.txt) is unmodified** —
it is the verbatim license text required by AISHELL-3's Apache-2.0 §4(a). The
`Copyright [yyyy] [name of copyright owner]` line near its end belongs to the
**APPENDIX ("How to apply the Apache License to your work")** and is *not* a
copyright notice for this distribution.

## Why this file exists

**The repository's [`LICENSE`](LICENSE) (MIT) does NOT cover the distributed model weights.**

MIT grants use "without restriction." These weights are distilled from a teacher
fine-tuned on the **Tsukuyomi-chan Corpus**, whose terms require attribution, restrict
what the generated audio may be used for, and **propagate those obligations to
downstream recipients**. The teacher's multilingual base additionally draws on
**CC BY 4.0 and Apache-2.0** speech corpora, which require attribution. Calling the
weights MIT would claim rights we do not have.

| Covered | License |
|---|---|
| Code and documentation in this repository | [MIT](LICENSE) |
| **Distributed model weights** (§1 above) | **This file** |

## Grant

Free of charge, including commercial use: use, copy, modify, create derivatives,
redistribute, and sublicense — **subject to the conditions below.**

## Conditions

1. **Attribution (mandatory).** Reproduce block **(A)** of §3.1 verbatim in your
   `NOTICE`, `README`, or credits. It covers the Tsukuyomi-chan Corpus (teacher
   fine-tune), **LibriTTS-R and CML-TTS (CC BY 4.0)**, **AISHELL-3 (Apache-2.0)** —
   all three in the teacher's multilingual base — and **JSUT ver1.1 (CC-BY-SA-4.0)**
   in the distillation text. These obligations come from upstream, not from this
   project. Block **(B)** is provenance only and carries **no** attribution duty
   (MOE-Speech explicitly waives credit; the rest is CC0 or public domain).
   ⚠️ **Copying block (A) verbatim does not by itself discharge everything
   AISHELL-3's Apache-2.0 license requires.** (A) supplies only a
   **link** to `https://www.apache.org/licenses/LICENSE-2.0`, not the
   **bundled license text** that Apache License, Version 2.0 §4(a) requires.
   If you redistribute this model with AISHELL-3-derived material in it, also
   **ship the full Apache-2.0 license text as a separate file** in your
   distribution (e.g. a `LICENSE-APACHE-2.0.txt` next to your `NOTICE`) —
   reproducing (A) alone does not discharge that duty.
   ✅ **That full text ships in this repository as
   [`LICENSE-APACHE-2.0.txt`](LICENSE-APACHE-2.0.txt)** (from the canonical
   `https://www.apache.org/licenses/LICENSE-2.0.txt`; sha256 `cfc7749b96f63bd3…`;
   202 lines, 11,358 bytes) — copy that file, do not retype it.
   ⚠️ **It is absent from the `v0.3.0` / `v0.3.1` release assets**
   (see [`docs/decisions.md`](docs/decisions.md) C-081).
2. **Output-use restrictions (mandatory, propagating).** Audio generated by this
   model may **not** be used for: attacks or criticism of individuals or
   organizations; political or religious advocacy; **publishing intense content
   without zoning**; or **publishing it in a form that permits others to reuse it as
   source material**. ⚠️ **Adult content as such is not prohibited** — the corpus
   provider states it places no limits on adult or violent expression as long as
   appropriate zoning is in place, and that distributing or selling finished works
   is fine. ⚠️ **The primary source separately states that distributing or selling
   audio synthesized with this voice *as material* is prohibited "in principle"**
   (原則的には) — this project has not determined what that qualifier permits or
   excludes. If you plan to distribute the synthesized audio itself as material
   (rather than as a finished work), confirm with the provider first. Imposing
   these four items in your own terms of use is itself required.
   Primary source: <https://tyc.rei-yumesaki.net/material/corpus/> — **check it
   before you distribute; if it conflicts with this file, the primary source wins.**
   ✅ You are **not** required to make your end users display credit.
3. **Pass the conditions on.** You may not strip conditions 1 and 2 when
   redistributing.
4. **Do not** relicense these weights as MIT / Apache-2.0 / CC0, imply endorsement by
   Tsukuyomi-chan (© Rei Yumesaki), or present this as the official implementation of
   arXiv:2608.21378 (it is an independent re-implementation).

## No warranty

Provided **AS IS**, without warranty of any kind. This is a proof-of-concept
artifact, not a production-quality model. See [`MODEL_CARD.md`](MODEL_CARD.md).

## Known legal risk

**6,380** of the distillation sentences come from **JSUT ver1.1 (CC-BY-SA-4.0)** (6,472
is the raw JSUT row count in `data/splits/corpus_train.tsv`; 92 of those uids were
already dropped by the B-10 teacher-fine-tune-overlap exclusion). If a trained model
were held to be a derivative work of its training text, share-alike could reach these
weights. We judged this unlikely (Japanese Copyright Act Art. 30-4; we do not
redistribute the corpus text) but **the risk is not zero**. This is our own reading of
primary sources, **not legal advice**.

### ✅ v4 removes this risk — ⚠️ **but v4 is not released yet**

On 2026-09-10 we trained and accepted **v4**, distilled from **CC0 / public-domain text
only** (14,513 rows — above the paper's 14,343), with **no share-alike material at all**
(`docs/decisions.md` D-057).

| | v3 (`v0.1.0`–`v0.3.1`, **still downloadable**) | v4 (**the current release, `v1.0.0`**) |
|---|---:|---:|
| JSUT ver1.1 rows | 6,380 | **0** |
| Share-alike risk | ⚠️ **as described above** | **none** |
| SCOREQ teacher ratio | 0.6444 | 0.6361 (**difference not detectable**) |

⚠️ **This section describes v3.** ✅ **The current release (v4 / `v1.0.0`) does not carry it.**
The v3 assets remain downloadable, and the risk stands
for anyone using them. In block (A) of §3.1, **the JSUT line is required for v3 weights
and not required for v4 weights** — check which you are shipping.
⚠️ **v4 removes nothing from the output-use restrictions or the propagation duty** —
those come from the Tsukuyomi-chan corpus. **Only the distillation-text share-alike
risk goes away.**

⚠️ **On 2026-09-10 we decided to keep the Tsukuyomi-chan voice**
(`docs/decisions.md` D-058). **The §3.2 output-use restrictions and the §3.3
propagation duty therefore remain in every future version too** — do not treat them
as something a later release will remove. If you ship this model in a product, you
**must** write the four §3.2 prohibitions into your own terms of use.
