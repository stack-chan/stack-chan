# WebMCP

WebMCP 対応のブラウザエージェントから、開いている画面の状態を読み取り、ブロック・顔・本体設定を編集できます。
一般向けの手順と依頼例は [使い方・AI連携](guide/) にあります。
ガイド画面と `stackchan.app.get_guide` は同じ翻訳済みデータを使います。

## ブラウザで試す

1. `web/` で `npm ci`、`npm run dev` を実行します。
2. 対応する Chrome で `chrome://flags/#enable-webmcp-testing` を有効にして再起動します。
3. 対象ページを開き、対応エージェントからツールを呼び出します。
   ガイドには、そのブラウザで WebMCP を利用できるか表示されます。

実装は `document.modelContext.registerTool(tool, { signal })` を使用します。
未対応ブラウザでは登録を省略し、通常の画面操作を利用できます。
旧 `navigator.modelContext` API やポリフィルは使いません。
API の最新仕様は [Chrome の Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) を参照してください。

## ツール

| 接頭辞                  | 操作                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stackchan.app`         | `get_context`, `get_guide`, `navigate`, `get_operation`, `cancel_operation`                                                                                                                          |
| `stackchan.editor`      | `get_project`, `get_catalog`, `create_project`, `update_project`, `edit_blocks`, `validate`, `build`, `run_simulator`, `stop_simulator`, `press_button`, `request_install_mod`, `request_remove_mod` |
| `stackchan.face`        | `get`, `update`, `reset`, `export`, `use_in_project`                                                                                                                                                 |
| `stackchan.preferences` | `get`, `get_schema`, `update`, `save`, `request_connect`, `disconnect`, `request_clear_wifi`                                                                                                         |

共通ツールは各ページに、操作ツールは対応するエディタ・設定ページに登録されます。
ファームウェア書き込み、Gallery、単独シミュレーター、MediaPipe ページはガイドと移動の対象です。
登録する入力スキーマと実行時の検証は Zod の同じ定義から作ります。
画面を閉じると AbortSignal でその画面の登録を解除します。
登録エラーは画面と `get_context.registrations` に表示されます。

## 状態を読んでから変更する

読み取り結果の `revision` を変更操作の `expectedRevision` に渡します。
画面操作・別のツール呼び出し・接続状態の更新によって内容が変わると、古い要求は `revision_conflict` になります。
状態を読み直し、変更内容を見直してから再実行してください。
リビジョンはページ内でのみ有効です。

結果は `{ ok: true, data }` または `{ ok: false, error: { code, message } }` です。
ページ遷移を伴うネイティブ呼び出しでは、ブラウザが `null` を返す場合があります。
移動後に移動先のツールを取得してください。

`edit_blocks` はコマンドを別の Blockly ワークスペースで検証した後、表示中のワークスペースへ一括適用します。
一括編集は 1 回の Undo で戻せます。
`get_catalog` のフィールド、接続名、`extraState` を参照し、作成時は明示的な ID を指定します。
変数は参照前に作成します。
可変入力や手続きの引数は `extraState` で設定できます。
使用中の変数削除、循環・不適合な接続、占有済み接続の暗黙の置き換えは拒否します。

```json
{
  "expectedRevision": "get_project が返したリビジョン",
  "commands": [
    { "op": "create", "id": "start", "type": "stackchan_on_start" },
    { "op": "create", "id": "smile", "type": "stackchan_set_emotion", "fields": { "EMOTION": "HAPPY" } },
    { "op": "connect", "id": "smile", "parentId": "start", "input": "DO" }
  ]
}
```

## 時間のかかる操作

ビルド、シミュレーター起動、実機操作、設定保存は操作 ID を返します。
`get_operation` で結果を確認してから次へ進みます。

| 状態           | 意味                                       |
| -------------- | ------------------------------------------ |
| `waiting_user` | 画面のボタン、デバイス選択、または確認待ち |
| `running`      | 処理中                                     |
| `succeeded`    | 結果を `result` に格納                     |
| `failed`       | 失敗理由を `error` に格納                  |
| `cancelled`    | 中断済み                                   |

USB・BLE の選択画面は、利用者がページ上のボタンを押したときに開きます。
実機 MOD の書き込み・削除には、検出した機種・ファームウェアを示す既存の確認画面を使います。
書き込み直前にもリビジョンを確認し、開始後はキャンセル不可となります。
成功結果にはインストーラーによる読み戻し検証結果が含まれます。
Wi-Fi 消去も画面での確認後に実行します。

設定はフォームを更新する `update` と送信する `save` が分かれています。
`save` の `sentKeys` は送信した項目、`confirmedKeys` は本体通知と値が一致した項目です。
送信成功だけで本体への保存確認済みとは扱いません。
`wifi.password`、`tts.token`、`ai.token`、`mcp.token` は書き込めますが、読み取り結果には有無だけを返します。
エラーに入力値やトークンを含めません。

## 検証

`web/` で以下を実行します。

```sh
npm test
npm run typecheck
npm run build
npm run test:webmcp
npm run test:visual
npm run test:i18n-visual
```

シミュレーターを含むブラウザテストの前に、対応 SDK 環境を読み込み、`firmware/` で `npm run build:wasm` を実行します。
`CHROMIUM_PATH` でテスト用ブラウザを指定できます。
通常の `test:webmcp` はテスト専用の登録アダプターを使います。
ネイティブの登録・発見・実行を検証する場合は次を実行します。

```sh
STACKCHAN_WEBMCP_NATIVE=1 npm run test:webmcp
```

ネイティブモードは API 未対応時に失敗し、アダプターへ切り替えません。
このテストは専用ブラウザでブロック編集、ビルド、WASM 実行、顔の受け渡し、設定の接続待ちとキャンセル、ガイド取得を検証します。
USB・BLE の物理通信は別途実機で確認してください。
