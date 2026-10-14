# 統合来歴と検証結果（2026-10-14）

## 作業境界

- branch: `feature/webtools-face-dsl`
- worktree: `C:/Users/sskw/Documents/Codex/2026-10-14/task/stack-chan-face-dsl`
- base SHA: `457096bbad2c7482b14ccee56de0b9a15e27c311`。合同版の #725 group clip と #717/#718/#726 の既存変更を前提とする。進行中の develop マージへ追従・介入しない。
- 参照元 task-2/task-6 は読み取りのみ。独立した Git 複製を作成し、他タスクの dirty files は編集しない。
- task-6 `d2c9700` の現在 tree から既存 web/avatar-dsl の editor-model、preview worker、transfer worker/controller、WebMCP とプリセットを選択して移植。既存履歴 b291b45/fd46b60/88b3eee/972b5cf の機能を継承する。8c6c9f1 の新 opcode・40要素候補は取り込まない。
- C 変更は既存 `buildOutline` の共通ヘッダ抽出のみ。VM、clip planner、native JS API、リソース上限、LCD 転送処理は変更しない。
- PR、push、merge、公開 deploy、デバイス列挙、COM12 接続、実機への書込みは行わない。

## 通過した検証

| 検証 | 結果 |
| --- | --- |
| TypeScript + Vite 本番ビルド | 成功。既存の大きい chunk 警告のみ |
| Web legacy suite | 231 passed、2 optional skipped、0 failed |
| 既存 React suite | 18 files / 51 tests passed。既存 Base UI button warning あり |
| native/WASM parity | 402 frames、119685120 bytes の画素一致。commands、clip/bounds、steps も一致 |
| C SENSOR | 101 開閉位相 × breath -1/0/1、同一 AVBC で検証。円外漏れなし、sensor 矩形は aperture 内、閉眼時消灯、呼吸で幾何不変、再開眼再現 |
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

## 未通過の共有 compiler 受入項目

追加連絡の [PR725 CodeRabbit 指摘](https://github.com/stack-chan/stack-chan/pull/725#discussion_r4272297742) に対し、エディタ独自の compiler/AST validator は実装しない。

固定ベースの現状は以下の通り。

| 無効 DSL | 現状 |
| --- | --- |
| user-function 引数不足 | compiler は通すが native VM の stack 検証で拒否 |
| user-function 引数過剰 | **compiler と C VM が受理するため、プレビュー・転送準備にも進める** |
| void helper の値利用 | compiler は通すが native VM の stack 検証で拒否 |
| void builtin の値利用 | compiler は通すが native VM の stack 検証で拒否 |

`npm run check:avatar-dsl:compiler` は上記 corpus を共通コンパイラと C runtime に渡し、compiler 段階で拒否されないケースがあれば exit 1 とする。今回の固定ベースでは引数過剰のため未通過。通常 suite の成功とは別の受入ゲートであり、隠して skip しない。

別担当の共有コンパイラ修正が利用可能になったら、そのコミットだけを取り込み、このゲートとプリセット/native/browser 試験を再実行する。修正確認までは「任意の無効 DSL をすべて拒否する」とは言えない。実機転送の受入は、この修正と実機確認の両方が残る。

## 残る実機・アプリ操作

実機の native host 搭載確認、Web Serial の実ポート選択と書込み承認、MOD 導入後の実画面・blink・breath の確認は未実施。COM12 の別担当の検証済み状態を保持した。ChatGPT アプリ内ブラウザ、実 Android も未検証。

現行仕様の WebMCP object 引数と Chromium 153 の JSON 文字列引数との差は試験ハーネスに記録。ページは登録側 API だけを使う。仕様の更新やブラウザ実装変更は別途確認する。
