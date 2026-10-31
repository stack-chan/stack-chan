# 統合来歴と検証結果（2026-10-14）

## レビュー公開準備（2026-10-31）

GitHub 上に顔 DSL エディタの既存 PR/公開ブランチはなかった。#725 は `feat/avatar-dsl-face-mod` / `5038a62a454ca137b9e65b9a8e24293763c3a084` のまま未マージ。現在の develop は `fc58d32a8e134aa7d9a615f40628260ecfd87997`。旧合同履歴をそのまま develop 向けにすると別件の BLE/Wi-Fi/シミュレーター変更を含み、firmware/package.json に競合がある。

旧 HEAD `18ab688a1d976f200a8e2fb22542190ec6f63077` はローカルの `archive/webtools-face-dsl-before-ready-20261031` に保存した。`git rebase --onto 5038a62 457096bb feature/webtools-face-dsl` でエディタ2コミットを依存 head の上へ載せ替えた。重複した compiler cherry-pick は既に依存 head に含まれるため Git が除外した。#725、develop、他タスクのブランチは変更しない。新 PR の base は #725 のブランチとし、エディタ差分だけをレビュー対象にする。依存取り込み後は develop へ向け直す前に統合検証が必要。

現在の develop と同じ Vite 8.2.4 / Vitest 4.1.12 に限定して依存を更新した。更新前の依存監査は high 1 / moderate 2、更新後は0件。製品の version は依存 PR の値を維持する。

再構成後のローカル検証はすべて成功した。`npm ci`、`npm audit`（0件）、compiler 受入ゲート、`AVDS_NATIVE_PARITY=1 npm test`（Web 230 passed / historical capture の任意試験1 skipped、React 18 files / 51 tests）、本番ビルド、隔離 Chromium 153 の通常 UI と native WebMCP を実行した。native/WASM は382 frames / 114266112 bytes、commands/clip/steps/pixels が一致した。firmware の compiler/VM 14 tests と native C 870 cases / C++ oracle 192 / 500 corruptions も成功した。Mono eye の DSL は旧 HEAD と同一で、名称変更・依存整理では描画を変更していない。Piu の82画像比較は下記の過去結果であり、今回再実行したとの扱いにはしない。

`.github/workflows/avatar-dsl-editor.yml` は base 名に依存しないエディタ専用 CI。Node 24、記録済み SDK revision の C raster、コンパイラ受入ゲート、既存 Web/React 試験、native/WASM parity、本番ビルドと隔離 Chromium での振る舞いを検証する。serial API は試験開始前にモックへ置き換え、実機・OS の Web Serial は使わない。この workflow には deploy、device discovery、USB 書込みはない。従来 Build/Bundle は base branch filter によりこの stacked PR では起動しない。Bundle 起点の Cloudflare preview も起動しない。

2026-10-31 に公式 WebMCP Draft（2026-10-27 版）を再確認し、登録側は引き続き `document.modelContext.registerTool(tool, {signal})`。実験 Chromium の caller 引数差は既存ハーネス内に限定し、製品には互換ラッパーを加えない。

以下の2026-10-14の結果は履歴。今回の再実行結果と未検証事項を PR 本文に記載する。実機の MOD 導入・blink/breath 表示、ChatGPT アプリ内ブラウザ、Android は引き続き未検証であり、別担当が使用中の機体へは接続しない。

## 作業境界

- branch: `feature/webtools-face-dsl`
- worktree: `C:/Users/sskw/Documents/Codex/2026-10-14/task/stack-chan-face-dsl`
- base SHA: `457096bbad2c7482b14ccee56de0b9a15e27c311`。合同版の #725 group clip と #717/#718/#726 の既存変更を前提とする。進行中の develop マージへ追従・介入しない。
- 参照元 task-2/task-6 は読み取りのみ。独立した Git 複製を作成し、他タスクの dirty files は編集しない。
- task-6 `d2c9700` の現在 tree から既存 web/avatar-dsl の editor-model、preview worker、transfer worker/controller、WebMCP とプリセットを選択して移植。既存履歴 b291b45/fd46b60/88b3eee/972b5cf の機能を継承する。8c6c9f1 の新 opcode・40要素候補は取り込まない。
- 追加共有 compiler: `5038a62a454ca137b9e65b9a8e24293763c3a084` を元 checkout からローカル Git fetch し、`cherry-pick -x` で `ae72f297a885128a80ccd18946de8032bad422b1` として取り込んだ。5ファイルの指定共有修正のみで、develop 全体の更新や独自 compiler 修正は加えない。
- C 変更は既存 `buildOutline` の共通ヘッダ抽出のみ。VM、clip planner、native JS API、リソース上限、LCD 転送処理は変更しない。
- PR、push、merge、公開 deploy、デバイス列挙、COM12 接続、実機への書込みは行わない。

## 通過した検証

| 検証 | 結果 |
| --- | --- |
| TypeScript + Vite 本番ビルド | 成功。既存の大きい chunk 警告のみ |
| Web legacy suite | 232 passed、2 optional skipped、0 failed |
| 既存 React suite | 18 files / 51 tests passed。既存 Base UI button warning あり |
| native/WASM parity | 382 frames、114266112 bytes の画素一致。commands、clip/bounds、steps も一致 |
| Mono eye | 101 開閉位相 × breath -1/0/1、同一 AVBC で検証。円外漏れなし、sensor 矩形は aperture 内、閉眼時消灯、呼吸で幾何不変、再開眼再現 |
| 既存 firmware native regression | 870 cases、192 C++ oracle cases、500 mutations passed |
| 既存 Piu/native regression | 73 reference + 9 cached frames、25190400 bytes、36 partial/full + 3 cached pairs、animation/lifecycle passed |
| MOD ビルド | 既存 tools.wasm で実 XSA を生成。fixture MOD 9775 bytes、XS ABI 17.9.2。共有 adapter/context と bytecode/fallback の保持を検証 |
| モック installer | 発見した xs partition のみ書込み・読戻し・reset・disconnect。機種/firmware/XS ABI 不一致、取消、読戻し破損は成功扱いにしない |
| ブラウザ通常 UI | Chromium 153.0.8010.12、WebMCP 無効。6 sensor 位相の canvas と同一 export の C pixels 一致、DSL download 一致、無限ループ拒否、undo 回復、390px 幅を確認 |
| ブラウザ転送 | 実 MOD worker で確認準備。取消・合成チェック・合成確認は USB 選択なし。実チェック＋実確認のみ mock chooser 1回。実ポートは選択しない |
| native WebMCP | Chromium 153、`--enable-features=WebMCP`、API はモックしない。6 tools 登録・取得・read/replace/undo/revision拒否・確認準備・無効 DSL 転送拒否を確認。USB chooser/enumeration 0回 |
| React lifecycle | 外部 AbortSignal で WebMCP 登録解除、次の mount の再登録を検証 |

現在の WASM SHA256 は `cba8328d7ac3910c958be9111c947f1fb64f2e283f98ba0518f4c64e58e70198`。SDK revision は `6ec053b83d1b00a27a19824e55bdf6a6101507a3`（10.0.1）、Emscripten 5.0.1。再ビルド来歴は `runtime/avds-build.json`。

再現可能な JSON/画像は実行後に `avatar-dsl/.test-output/{parity,archive,compiler-acceptance}.json`、`avatar-dsl/artifacts/{browser,webmcp-native}.json`、`sensor-half.png`、`mobile.png` に生成する。これらの出力は Git に含めない。

## 通過した共有 compiler 受入項目

[PR725 CodeRabbit 指摘](https://github.com/stack-chan/stack-chan/pull/725#discussion_r4272297742) の指定共有修正 `5038a62` を `cherry-pick -x` で取り込んだ。元の author と source SHA をコミットメッセージに保持した。エディタ独自の compiler/AST validator は実装していない。

| 無効 DSL | 取り込み後の拒否段階 |
| --- | --- |
| user-function 引数不足 | compiler |
| user-function 引数過剰 | compiler |
| user-function の void 値利用 | compiler |
| void builtin の値利用 | 既存 native VM の stack 検証 |

`npm run check:avatar-dsl:compiler` は通過。引数不正の corpus は void 呼出しを文として置き、値文脈の拒否に先取りされないよう引数数を独立に検証する。user-function の3項目は compiler 拒否を必須とし、builtin 項目は compiler または native VM による拒否を要求する。取り込み元は builtin の compile-time 検証を変更していないため、その段階まで変更されたとは主張しない。すべての corpus はプレビューの成功・転送確認・USB 選択へ進まない。

native WebMCP の実ブラウザでも syntax、引数不足、引数過剰、void helper 値、void builtin 値の転送要求が拒否され、undo で回復し、USB chooser/enumeration は0回だった。

共有修正の14件の既存試験は正常 DSL と3 firmware preset の emission 不変を確認する。追加エディタ試験も rounded/compound/Mono eye を独立した upstream emitter snapshot と比較する。`mono-sensor.avdsl` は最初の統合コミット `a31b7590` から変更しない。Mono eye の描画・開閉・呼吸は変更せず、Mono iris の選択肢と独立 sample ファイルのみを削除した。UI のプリセット値、guide の名前、WebMCP sample names は7件で一致し、単眼の名前は正確に `Mono eye`。

接続断後の再開時は既存試験ログの完了結果と作業ツリーを確認した。開いているブラウザの DSL やページを操作・上書きせず、ローカル preview サーバーだけを再起動した。

## 残る実機・アプリ操作

実機の native host 搭載確認、Web Serial の実ポート選択と書込み承認、MOD 導入後の実画面・blink・breath の確認は未実施。COM12 の別担当の検証済み状態を保持した。ChatGPT アプリ内ブラウザ、実 Android も未検証。

現行仕様の WebMCP object 引数と Chromium 153 の JSON 文字列引数との差は試験ハーネスに記録。ページは登録側 API だけを使う。仕様の更新やブラウザ実装変更は別途確認する。
