# V2 SDK の実装契約

このブランチで実装済みの公開入口は `stackchan` です。公開型はこのディレクトリーのTypeScriptを正本とし、ホストの `capabilities` やテスト用の型を教材へ渡しません。再設計全体の進捗と未実装項目は[実装台帳](../../docs/architecture/firmware-sdk-redesign-progress.md)で管理します。

```js
import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    app.input.onPress('primary', async () => {
      await app.audio.tone(440, { durationMs: 200 })
      app.face.setEmotion('happy')
    })
  },
})
```

`defineApp` は `apiVersion: 2` とsetupを持つ定義を作ります。V2定義にはV1の既定動作をマージしません。setupは登録後に返り、アプリはホストが閉じるまで動作します。setupの失敗時は登録を解除し、同じ失敗を開始元へ返します。setupは任意で同期disposerを返せます。終了後に遅れて返ったdisposerも実行します。

| API | 完了と所有 |
| --- | --- |
| `face.setEmotion` / `setMouthOpen` / `setColor` | 同期更新。色0〜255、開度0〜1。未知の名前や不正値はエラー |
| `audio.say(text, options?)` | 自由文の発話完了を待つ。素材名として解釈しない |
| `audio.playClip(name, options?)` | ローカル音声素材の再生完了を待つ。名前には拡張子やパスを含めない |
| `audio.tone(hz, { durationMs, volume?, signal? })` | 音の再生操作を待つ。音量0〜1。音声操作は同じ出力キューで直列化 |
| `input.onPress('primary', handler)` | 購読を登録し解除関数を返す。同じhandlerの実行中は連打を追加実行しない |
| `time.sleep(durationMs)` | アプリに所属する待機。終了時にタイマーを解除してreject |
| `time.every(intervalMs, handler)` | handlerの終了からintervalMs後に次回実行。例外は報告して周期処理を終了 |
| `ui.showBalloon(text)` / `hideBalloon()` | アプリの吹き出し。終了時に消去 |
| `capabilities.get(id)` | `native` / `simulated` / `unavailable` を取得。未対応時は理由を持つ |

有限の非同期操作はPromiseを返し、失敗は `StackchanError` の `code` で判別します。現在のコードは `INVALID_ARGUMENT`、`UNSUPPORTED`、`BUSY`、`TIMEOUT`、`CANCELLED`、`CLOSED`、`IO`、`CONFIG` です。終了後の操作は `CLOSED`。音声は待機8件、待機期限30秒、実行期限120秒、アプリの同時タスクと登録はそれぞれ64件を上限とします。

アプリ終了はすべてのSDK操作へ伝わります。個別の購読解除と操作取消しを結び付ける場合、handler引数の `task.signal` を音声optionsへ渡します。`task.sleep` はこのsignalに最初から所属します。任意のJavaScript Promiseの内部処理を強制停止するものではありません。

```js
app.input.onPress('primary', async (task) => {
  await task.sleep(100)
  await app.audio.say('こんにちは', { signal: task.signal })
})
```

公開SDKと教材を `npm run check:sdk` でstrict検査します。構成検査はTypeScriptの構文木でSDKからホスト内部への依存がないことを確認し、コンパイラーが解決したファイル一覧で全教材の検査対象への包含を確認します。使用するTypeScript 7 APIは版に依存するため、開発依存は検証した版へ固定しています。

現在は首操作・録音・カメラ・会話・設定・Piu拡張のV2公開契約と、全配布経路のV2互換性検査が未実装です。ホスト内部の起動途中のrollbackと物理バスの管理も別途移行します。V1の内部I/FをこのSDKへ再exportして補完する方針は採りません。
