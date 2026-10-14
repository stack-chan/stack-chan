# 顔 DSL エディタ

Web tools のホーム・ナビゲーションから `/avatar-dsl/` を開く。既存の Shape 顔エディタも利用できる。DSL を編集・読み込み、C/WASM で検証・プレビューし、DSL または AVBC を保存できる。

共有 compiler の関数呼出し検証修正は固定ベースに未反映。引数過剰の無効 DSL を受理する受入課題が残る。修正取り込み前の実機転送受入は未完了で、再現手順は [VALIDATION.md](VALIDATION.md) を参照。

## 小さい統合設計

- ページ枠・テーマ・ナビゲーションは既存 React `AppShell`。エディタは既存 `editor-model.mjs` と DOM 制御を利用し、React の mount/unmount で worker、イベント、WebMCP 登録を解除する。
- コンパイラは `firmware/tools/avatar-dsl/compiler/compile.js`。WASM は固定ベースの C VM・group clip planner と現行 SDK の FreeType。native.c の既存 outline 生成を `avds-outline.h` へ抽出し、実機と WASM の両方から使用する。
- 新しい MOD 形式や host の AVBC 直接書込み API は追加しない。既存 `buildModArchive` が共有 native face adapter/context、編集 AVBC、安全な default AVBC を XS archive に収録する。既存 `installModToDevice` が対象機種・XS バージョン・firmware descriptor を検証し、発見した xs パーティションだけを書込み、読戻し・reset・disconnect する。
- ソースは UTF-8 32 KiB、編集 AVBC は 16 KiB、VM は 12000 instructions/96 draw commands、planner は32 primitives。プレビューは期限付き worker。失敗すると前の画面を残し、AVBC 保存と転送を無効化する。選択コンテキストでの検証であり、任意 DSL の全分岐を静的に保証するものではない。実機 adapter の既存 fallback を保持する。

転送準備は現在の DSL を再検証して MOD を構築し、確認ダイアログを表示する。編集・プレビュー条件変更・undo・取消は準備中の worker と確認を無効化する。書込みはページの native host 確認チェックと確認ボタンの実ユーザー操作後に限る。その操作内で Web Serial のポート選択を要求し、返されたポートだけを installer に渡す。既存接続の自動列挙・別ポートへのフォールバックはしない。合成イベントでは承認できない。

ESP descriptor は native Avatar DSL モジュールの有無を表さないため、XS ABI の互換判定とは別に native host 導入済みの確認が必要。対応 host が必須であり、SDK の版数だけでは native モジュールの搭載を証明できない。

## プリセットと C SENSOR

Default/Aokko/Omega、rounded、mono iris、compound iris、minimal と Mono C SENSOR を収録。C SENSOR は task-6 の d2c9700 の固定支点モデル、暗い円形開口、小さいシアンセンサー、外周9 px、センサー30/18 pxを継承する。単眼の境界は五角形の辺を時計回りに延長し、開眼側では五角形が円に外接する。

task-6 の HTML に残っていた絞り計算を既存 DSL の sqrt/四則演算へ移し、一つのバイトコードで host の `eye_open` に追従させた。センサー色は既存 `breath` [-1,1] に追従する。エディタのスライダーは同じコンテキストを WASM に渡すだけで、エクスポート用ソースを再生成しない。host の既存 blink/breath clock を使用するため、MOD に別タイマーを加えない。

円マスク・rounded rect の新 opcode は追加しない。センサーは7本までの重なる矩形を円の内側へ保守的に切り詰める近似。seam の量子化と AA を円内に保つため端を2 px内側へ寄せる。元の snapshot の全画素一致は主張しない。円外漏れ・閉眼時の消灯・呼吸で形が動かないこと・再開眼の再現性を C 出力で検証する。32要素を超える候補や40要素circle-mask拡張は取り込まない。

## WebMCP

2026-10-14 に [公式 Draft Community Group Report](https://webmachinelearning.github.io/webmcp/) と [Chrome early preview](https://developer.chrome.com/blog/webmcp-epp) を確認した。現在の `document.modelContext.registerTool(tool, {signal})` を feature detection して、guide/sample/read/replace/undo/request_transfer の6ツールを登録する。未対応・登録拒否時も通常エディタを利用できる。

replace は revision 照合と undo 履歴を必須とする。`stackchan_face_request_transfer` はコンパイルとページ上の確認準備まで。ポート選択や書込みを直接行うツールは提供しない。

今回の Chromium 153 実装では `executeTool` の引数が JSON 文字列だったため、試験ハーネスのみ object/文字列を試す。現在の仕様は object 引数である。エディタは登録側 API だけを使い、この暫定 caller 差異のための独自ブリッジは加えない。ChatGPT アプリ内ブラウザと実機転送は未検証。

## 再現

```sh
cd web
MODDABLE=/path/to/sdk EMCC=/path/to/emcc npm run build:avatar-dsl
npm run test:avatar-dsl
MODDABLE=/path/to/sdk AVDS_NATIVE_PARITY=1 npm run test:avatar-dsl # native/WASM 比較も実行
CHROMIUM_PATH=/path/to/chromium npm run test:avatar-dsl:browser
npm run dev -- --host 127.0.0.1
```

source/build 来歴と実行結果は [VALIDATION.md](VALIDATION.md)、ランタイムのライセンスは [runtime/NOTICE.md](runtime/NOTICE.md) に記載。
