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

`defineApp` は `apiVersion: 2` とsetupを持つ定義を作ります。既定動作も同じ定義で起動します。インストールされたMODへの既定フックの継承はありません。setupは登録後に返り、アプリはホストが閉じるまで動作します。setupの失敗時は登録を解除し、同じ失敗を開始元へ返します。setupは任意で同期・非同期の `AppDisposer` を返せます。終了後に遅れて返ったdisposerも1回だけ実行し、非同期の失敗もエラー通知へ渡します。任意のPromiseが終わるまでアプリ終了を待たせることはありません。

配布用の `stackchan-mod.json` には schema 2 / app API 2 と必要な host API 世代を記録します。教材では世代2を要求し、標準 manifest の `data` で同梱しています。XS のコンパイル版とは別の検査です。CLI・WebSerial の接続状況と、旧 MOD・SD・WASM・起動時の移行上の制約は [MOD の互換性検査](../../docs/architecture/mod-package-compatibility.md) を参照してください。

`targets` は通常 `['portable']` を使います。機種専用なら `m5stackchan-cores3`、`stackchan-rt`、`takao-core2-sg90` などの [共通機種ID](../../docs/architecture/mod-package-compatibility.md#機種idを一つの定義から使う) を宣言します。CLIのビルド名のアンダースコアとは区別してください。書き込み先はファームウェア内の機種IDで照合し、IDのない旧ファームウェアには更新を案内します。`capabilities` は機種を制限しない場合も検査します。

| API | 完了と所有 |
| --- | --- |
| `face.setEmotion` / `setMouthOpen` / `setColor` | 同期更新。色0〜255、開度0〜1。未知の名前や不正値はエラー |
| `audio.say(text, options?)` | 自由文の発話完了を待つ。素材名として解釈しない |
| `audio.playClip(name, options?)` | ローカル音声素材の再生完了を待つ。名前には拡張子やパスを含めない |
| `audio.tone(hz, { durationMs, volume?, signal? })` | 10〜20,000 Hz、0〜60,000 ms、音量0〜1。再生と出力解放を待つ |
| `audio.record({ durationMs?, signal? })` | 入力を解放してから録音データを返す。省略時3秒 |
| `audio.play(audio, { volume?, signal? })` | 録音などの音声データを再生する。発話・素材・toneと同じ出力キューで直列化 |
| `motion.move({ yawDeg, pitchDeg }, { durationMs, timeoutMs?, completion?, signal? })` | 指定時間の軌道を送り終えるまで待つ。位置を読める機種では到達も確認。結果は `measured` または `estimated` |
| `camera.capture({ width?, height?, format?, signal? })` | 一枚をコピーし、元フレーム解放・カメラ停止後に返す |
| `camera.info` | 使用可否と対応画像形式を取得 |
| `ui.showImage(image)` / `hideImage()` | RGB565画像を表示。置換・非表示・アプリ終了で表示を外す |
| `motion.info` | 使用可否、位置フィードバック、トルク解除の可否、設定済みの角度範囲を取得 |
| `motion.lookAt(target)` / `lookAway()` | 注視先を設定・解除。単発移動を優先し、終了後に最新の注視先へ戻る |
| `motion.relax()` | host API 4以上。停止を待ち、対応するドライバーのトルク解除完了を待つ。故障後も解放を試すが、故障した動作の利用不可は解除しない。停止と解放がともに失敗した場合は最初の失敗を返す。`canRelax: false` は `UNSUPPORTED` |
| `motion.stop()` | 注視と待機中の移動を取り消し、進行中の動作の停止処理を待つ |
| `input.onPress('primary', handler)` | 購読を登録し解除関数を返す。同じhandlerの実行中は連打を追加実行しない |
| `time.sleep(durationMs)` | アプリに所属する待機。終了時にタイマーを解除してreject |
| `time.after(durationMs, handler)` | host API 4以上。一度だけ実行。解除関数は待機と実行中handlerの両方を取り消す |
| `time.every(intervalMs, handler)` | handlerの終了からintervalMs後に次回実行。例外は報告して次の周期で再試行 |
| `ui.showBalloon(text)` / `hideBalloon()` | アプリの吹き出し。終了時に消去 |
| `capabilities.get(id)` | `native` / `simulated` / `unavailable` を取得。未対応時は理由を持つ |

有限の非同期操作はPromiseを返し、失敗は `StackchanError` の `code` で判別します。現在のコードは `INVALID_ARGUMENT`、`UNSUPPORTED`、`BUSY`、`TIMEOUT`、`CANCELLED`、`CLOSED`、`IO`、`CONFIG` です。終了後の操作は `CLOSED`。音声とmotionはそれぞれ待機8件、待機期限30秒、実行期限120秒、アプリの同時タスクと登録はそれぞれ64件を上限とします。

アプリ終了はすべてのSDK操作へ伝わります。個別の購読解除と操作取消しを結び付ける場合、handler引数の `task.signal` を音声・motion・撮影のoptionsへ渡します。`task.sleep` はこのsignalに最初から所属します。任意のJavaScript Promiseの内部処理を強制停止するものではありません。

```js
app.input.onPress('primary', async (task) => {
  await task.sleep(100)
  await app.audio.say('こんにちは', { signal: task.signal })
})
```

公開SDKと教材を `npm run check:sdk` でstrict検査します。構成検査はTypeScriptの構文木でSDKからホスト内部への依存がないことを確認し、コンパイラーが解決したファイル一覧で全教材の検査対象への包含を確認します。使用するTypeScript 7 APIは版に依存するため、開発依存は検証した版へ固定しています。

## 声を録音して再生する

```js
app.input.onPress('primary', async (task) => {
  const audio = await app.audio.record({ durationMs: 3000, signal: task.signal })
  await app.audio.play(audio, { volume: 0.5, signal: task.signal })
})
```

`app.capabilities.get('audio.recording')` と `audio.playback` で機能の有無を確認できます。ブラウザーではマイクの使用許可が必要です。録音は1〜15,000ms、最大512 KiBで、戻り値は `data: ArrayBuffer`、実際の `mimeType` と `filename` を持ちます。機種側はPCM WAV、ブラウザー側はWebMやMP4などを返すため、形式をWAVと決めつけないでください。許可拒否を無音の録音に置き換えることはありません。

録音と再生は完了時に入力・出力を解放し、アプリ終了時にも停止します。再生中は渡したバイト列を変更しないでください。nativeのバッファ再生は16-bit PCM WAV、8〜48 kHz、モノラルまたはステレオに対応し、上限は3 MiB・60秒です。ブラウザーの再生形式はそのdecoderに依存します。

機能がない場合はUNSUPPORTED、不正な引数はINVALID_ARGUMENT、録音・再生の失敗はIO等でrejectします。未対応時とエラー時の案内も含む例は [07-recording](../lessons/07-recording/mod.js)、詳しい形式・所有の契約は [録音とバッファ再生](../../docs/architecture/sdk-recording-playback.md) にあります。

## 首の動作を待つ

```js
app.input.onPress('primary', async (task) => {
  const result = await app.motion.move(
    { yawDeg: 15, pitchDeg: 0 },
    { durationMs: 350, signal: task.signal },
  )
  app.ui.showBalloon(result.completion === 'measured' ? '到達を確認しました' : '動作指令が完了しました')
})
```

角度は校正した正面からの度数です。`yawDeg` の正はロボットから見た左、`pitchDeg` の負は上を向きます。範囲は `app.motion.info` から取得し、範囲外や `NaN` は `INVALID_ARGUMENT` になります。機種を判別して角度を補正する処理を教材へ書く必要はありません。

`durationMs` は0〜60,000msです。準備と初期位置の取得後に軌道時間を数え、0msでも最後の指令の送信を待ちます。`timeoutMs` は1〜120,000msで、キューから実行を始めた時点からの準備・軌道・到達確認を含む期限です。省略時は `durationMs + 5,000`。待機列にいる時間には別の30秒の期限があります。

位置を測れる機種では、軌道の最後に両軸が目標の±1°以内であることを50ms以上離れた2回の測定で確認し、`{ completion: 'measured' }` を返します。PWMとWASMは位置の実測を持たないので、最後の指令を送って `{ completion: 'estimated' }` を返します。これは実際の首や画面上のモデルが静止したという保証ではありません。実測が必要なら `completion: 'measured'` を指定し、未対応の機種では送信前に `UNSUPPORTED` を受け取ります。省略時と `'trajectory'` 指定時も、測定可能な機種は到達確認まで待ちます。

`lookAt` は最新の注視先を一つ保持します。単発の `move` が入ると注視動作を止め、単発移動の待機列が空になってから最新の注視先へ向き直ります。同じ注視先へ到達後は移動を追加し続けません。`lookAway` は解除要求を出して同期で返ります。

取消しを受けたアプリの処理は早くrejectする場合がありますが、内部の実行枠は停止処理が終わるまで保持します。停止処理を待つには `await app.motion.stop()` を使います。明示的なstopで移動は `CANCELLED`、停止中の新規受付は `BUSY` となります。位置を測れる機種では停止時の測定位置を保持し、PWMとWASMでは最後の指令位置を保持します。停止確認は2秒で期限となり、失敗した資源に次の移動を送らず、能力情報を `unavailable` にします。ホスト再起動を復旧境界とします。

アプリ終了も停止処理を待ち、対応機種のトルクを解除してdetachします。PWMはトルク解除を持たず `canRelax: false` です。物理PWMやUARTの解放はホスト終了時に行います。WASMは `availability: 'simulated'`、nativeのnone設定や必要なサーボ電源の未検出は `unavailable` です。

詳細な所有・停止契約と実機受入の残りは [motionの設計記録](../../docs/architecture/motion-operation-lifecycle.md) を参照してください。会話・設定を含む実行例のSDK移行は完了しました。Blocklyも同じSDKへ移行しました。host API 9でV1ホストを撤去しました。実機および初学者による受入は引き続き未完了です。


## 一枚を撮って表示する

```js
app.input.onPress('primary', async (task) => {
  const image = await app.camera.capture({ width: 176, height: 144, signal: task.signal })
  app.ui.showImage(image)
})
```

撮影前に `app.camera.info.availability` を確認できます。利用できない機種は `unavailable`、ブラウザーのカメラ入力は `native`、明示的な合成画像は `simulated` です。ブラウザーの許可拒否や未取得を合成画像へ置き換えて成功にはしません。

`width` は1〜320、`height` は1〜240の整数です。省略値は176×144、形式は `rgb565le` です。対応形式は `app.camera.info.formats` で取得します。画像は実際の寸法、`format`、`source`、`data: ArrayBuffer` を持ち、nativeの手動解放は不要です。返却データは最大153,600 bytes。JPEGを取得できる機種でも、`ui.showImage` の対応形式はRGB565です。

撮影は一つずつ進め、待機2件、待機期限30秒、実行期限15秒、取消し時の停止確認2秒です。撮影中にアプリが終了すると取消します。画像を配列などに蓄積した場合のメモリーはアプリ自身が管理します。使用例は [06-camera](../lessons/06-camera/mod.js)、詳しい契約と移行事項は [撮影と画像表示](../../docs/architecture/camera-capture-lifecycle.md) にあります。

## Piu の画面拡張

Piu を使う画面は `stackchan/extensions/piu` の `definePiuApp` で宣言します。基本 SDK の入口には Piu 型・コンストラクターを追加しません。初めてのプログラムは `defineApp` と7つの教材から始め、独自画面が必要になったときにこの拡張へ進んでください。

```ts
import { Behavior, Container, Skin, definePiuApp } from 'stackchan/extensions/piu'

export default definePiuApp({
  screens: [{
    id: 'hello',
    title: 'Hello',
    create({ app, close }) {
      return new Container(null, {
        left: 0, right: 0, top: 0, bottom: 0,
        active: true,
        skin: new Skin({ fill: '#93c5fd' }),
        Behavior: class extends Behavior {
          onTouchEnded() { app.face.setEmotion('happy'); close() }
        },
      })
    },
  }],
})
```

この例は青い画面を表示し、タップすると表情を変えて顔画面へ戻ります。

画面の登録、任意の `setup(app)`、入力・音声・motion は同じ `AppSession` に所属します。`create` に渡る `ScreenContext` は `{ width, height, app, close }` です。高さは AppBar の44pxを除きます。ホストの Application / controller は公開しません。画面は最大16個で、IDは小文字ASCII英数字と `. _ -` の区切りで1〜64文字、タイトルは空白を除いて1〜32文字です。

`create` は Piu `Container`、または `{ content: Container, dispose() }` を返します。開くたびに作り直し、「戻る」・`close()`・アプリ停止で破棄します。Piu `Port` のフレーム更新は画面の `onUndisplaying` で止めてください。画面固有の外部資源は `dispose` で解放します。`context.app.time.every` などの SDK 登録を画面だけの寿命にする場合は、返された解除関数をこの `dispose` で実行してください。アプリ全体の停止でも SDK 登録は解除されます。`dispose` は、画面を作成したが表示に失敗した場合にも呼ばれるため、非表示処理に依存せず解放できるようにします。

画面登録や setup が失敗した場合は、登録済み画面を巻き戻します。ホストの画面切替や `dispose` の例外でも後続の後片付けを実行し、アプリ停止時には失敗を呼出元へ返します。Piu 自体が処理するイベント callback の例外は、この停止 Promise に伝わるとは限りません。Piu の生の表示オブジェクトを使う拡張であり、通常の MOD と同じ実行 realm です。任意コードを隔離する sandbox ではありません。

配布には schema 2 / app API 2 / **host API 3**、`entrypoints: ["mod"]` と `capabilities: ["ui.piu"]` を宣言します。旧 `miniapp` archive は起動前に拒否されるので、旧ソースをこの契約に移して再ビルドしてください。`manifest.json` は通常の MOD と同じで、アプリ内の相対 import に使うファイルを `modules` に列挙します。[ミニゲーム集](../mods/examples/stackchan_minigames/mod.ts) と [UI Playground](../mods/examples/mini_app_ui_sample/mod.ts) が実行可能な例です。

`npm run check:sdk` は基本 SDK / 教材の `tsconfig.sdk.json` と、Piu 拡張 / 利用例の `tsconfig.extensions.json` を分けて strict 検査します。構成検査は全 API 2 パッケージを列挙し、`ui.piu` を宣言したものだけに Piu 拡張の import を許します。

SDK の TypeScript ソースは `stackchan` というローカル npm workspace としても解決します。`firmware/` で `npm ci` すると型の正本へリンクされ、通常の `mod:build` でも同じ型を使います。ホスト SDK の実装を MOD archive へ複製する必要はありません。Gallery のソースをリポジトリー内でビルドする場合は、`web/` でも `npm ci` を実行してください。別のプロジェクトから使う場合は SDK ディレクトリーを `stackchan` のローカル依存として設定します。このパッケージはまだ npm へ公開していません。

## メニュー・入力・LEDの拡張

host API 4以上では、Piuの生成を伴わない操作を専用の入口から取得できます。いずれも `setup(app)` と同じアプリに所属し、別のセッションやコントローラーを作りません。

```js
import { defineApp } from 'stackchan'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  setup(app) {
    const view = ui(app)
    view.addAction({ id: 'hello', label: 'Hello' }, async (task) => {
      view.closeMenu()
      await app.audio.say('こんにちは', { signal: task.signal })
    })
    view.addToggle({ id: 'happy', label: 'Happy', value: false }, (enabled) => {
      app.face.setEmotion(enabled ? 'happy' : 'neutral')
      view.setEmoticon(enabled ? 'heart' : null)
    })
  },
})
```

`addAction` は解除関数、`addChoice` / `addToggle` は `{ setValue, close }` を返します。選択項目には `options: [{ value, label, color? }]` を渡します。`color` は `#RRGGBB` の色見本です。`handler(value, task)` が成功した後に値を確定し、失敗時は前の表示へ戻します。実行中に `setValue` で変更した値を、古いhandlerの完了で上書きしません。同じ登録は実行中に再入せず、`close` とアプリ終了はhandlerのsignalも取り消します。

IDはPiu画面と同じ1〜64文字の小文字ASCII英数字と区切り `. _ -`、labelは空白だけを除く1〜160文字です。選択肢は最大32個、valueは1〜80文字で一意にします。アプリの登録上限64件を他の入力・タイマーと共有します。

`setFaceStyle` は `default / simple / dog / image / avatar`、`setHandAnimation` は `none / rock-paper-scissors / clap / thinking`、`setEmoticon` は `heart / angry / sweat / tear / sleepy / null` を受け取ります。`default` は本体設定の顔へ戻します。アプリ終了時は顔・色・表情・手・装飾を本体の初期状態へ戻します。`localize(key, parameters?)` は本体と同じ言語でアプリの辞書を解決します。[顔と翻訳メニューの実行例](../mods/examples/face/mod.js) と [ローカライズ](../docs/localization_ja.md) を参照してください。配布宣言は app API 2 / host API 4 / `capabilities: ["ui.controls"]` です。

host API 6以上では `view.setImageAvatar(pack)` で画像パックを選びます。型は `stackchan/image-avatar` の `ImageAvatarPack`（UI拡張からも型をexport）で、目と口は静止パーツと同じ `texture / x / y / width / height` に横並びの `frameCount` を加えます。画像名とフレームサイズの二重指定はありません。`EMOTIONS` は `stackchan` がexportする `neutral / angry / sad / happy / sleepy / doubt / cold / hot` の配列で、`emotionMap` と `face.setEmotion` は同じ名前を使います。未割り当ての表情は `defaultExpression` に戻ります。

選択時にパックを検証・コピーし、全表情の画像を準備してから表示を置換します。大きさの違う顔への切り替えでは表示の中心を保ち、以前の小さな顔の左上位置によって画像が画面外へはみ出すのを防ぎます。パックの後からの変更は表示へ影響せず、変更を反映するには再度選びます。不正なパックは `INVALID_ARGUMENT`、画像の読み込み失敗は `IO` です。失敗時は選択済みの顔を保持します。`faceStyle` は `avatar` となり、`setFaceStyle('avatar')` は本体付属のデモ画像を選びます。終了時の復元は他の顔と同じ所有処理です。PNGはMODが同梱し、グローバル登録・名前だけの選択・`ui.avatar` は廃止しました。[6キャラクターの実行例・データ制限・改造と復帰の手順](../mods/examples/image_avatar_lite/README_ja.md)を参照してください。配布宣言は app API 2 / host API 6 / `capabilities: ["ui.controls"]` です。

`input(app)` を `stackchan/extensions/input` から取得すると、`onPress('primary' | 'secondary' | 'tertiary', handler)`、`onHeadTouch(handler)`、`onMotion(handler)` を使えます。ボタン名は利用できるA/B/Cの順番で、primaryだけはボタンのない機種でメニューの「実行」を使えます。head touchは `gesture` と任意の `tapDurationMs`、motionは `motion` を持つ読み取り専用イベントです。時間はmsで、raw device・ticks・ドライバーは渡しません。実行前に `capabilities.get('input.headTouch')` などで対応を調べます。購読解除とアプリ終了で処理を取り消し、最後のmotion購読解除でIMUのポーリングを止めます。

`lighting(app)` を `stackchan/extensions/lighting` から取得すると、`names` に実際に使えるLED名が並びます。`color(name, { r, g, b })`、`rainbow(name)`、`off(name)` を使い、アプリが使用したLEDは終了時に消灯します。WASMは出力bridgeを持たないため `lighting` は `unavailable` です。未検出のPY32も成功として扱いません。未対応は `UNSUPPORTED`、未知の名前は `INVALID_ARGUMENT`、機器例外は `IO` です。host API 5以上では `blink(name, { r, g, b }, { periodMs })` も使えます。`periodMs` は点灯と消灯を合わせた1周期で、100〜86,400,000 msです。別の効果へ切り替えると前の効果を止め、アプリ終了時も消灯して機器のタイマーを止めます。実行例は [ボード診断](../mods/examples/board_diagnostics/mod.js) です。個々のLED範囲の指定は旧APIに残り、公開SDKにはまだ含みません。

## 通信・会話・センサー・保守の拡張（host API 7）

残る実行例は [全21パッケージ](../mods/examples/README_ja.md) に整理しました。必要な機能を専用の入口から取得します。AppContext の基本操作を覚えた後に、目的に合う拡張へ進んでください。

| 入口 | 操作 | 実行例 |
| --- | --- | --- |
| `stackchan/extensions/network` | `ready`、HTTP request / stream / server、WebSocket、Local Peer、STK、beacon、DNS-SD、MCP tools | `local_peer_hello`、`beacon`、`cheerup`、`pose_sharing`、`face_tracker`、`mcp` |
| `stackchan/extensions/conversation` | `dialogue`、`transcribe`、`realtime`、USBの `remote` | `conversation`、`chat_audioio`、`codex_voice` |
| `stackchan/extensions/audio` | `streamingAudio(app).monitor` / `radio` | `lip_sync`、`web_radio` |
| `stackchan/extensions/sensors` | `sensors(app).openTemperature` | `unit_temperature` |
| `stackchan/extensions/maintenance` | `maintenance(app)` の状態読取・校正・ID・LED・バス速度 | `servo_diagnostics` |
| `stackchan/extensions/settings` | `settings(app).get` / `describe` / `set` | 会話とサーバーの設定 |

接続・機器は同じ AppSession に登録されます。返された `Connection.close(): Promise<void>` は、購読と実行中の操作を止めてから機器を解放します。二重 close は同じ終了処理を使い、close 開始後のイベントをアプリへ渡しません。開始が遅れてアプリ終了後に完了した場合も取得した機器を解放します。アプリの登録・実行タスクは各64件、接続内の資源も64件までです。上限を超えた取得は後片付けして `BUSY` にします。

```ts
import { defineApp } from 'stackchan'
import { network } from 'stackchan/extensions/network'

export default defineApp({
  async setup(app) {
    const peer = await network(app).openPeer({ service: 'example.hello', displayName: 'receiver' })
    peer.onMessage('text', ({ payload }) => {
      if (typeof payload === 'string') app.ui.showBalloon(payload)
    })
    // peer と購読はアプリ終了時に閉じる。個別停止では await peer.close()。
  },
})
```

通信を使う例でも、Wi-Fi が必要な操作だけが `network.ready({ signal })` を待ちます。Local Peer / BLE のために Wi-Fi 接続を必須にはしません。各方式の既存ワイヤー形式はホスト内の実装で保持し、アプリには文字列・JSON・度・msの値を渡します。

HTTP `request` は既定30秒・応答65,536 bytes、最大120秒・1,048,576 bytesです。取消し・期限・読取失敗で物理接続を閉じます。`stream` は一文字のASCII区切りでUTF-8を復元し、`maxResponseBytes` は1メッセージの上限（既定16,384、最大65,536 bytes）、`timeoutMs` は無受信の期限です。UnitV2のように応答が終わらない通信に使い、全応答を蓄積しません。HTTPサーバーのhandlerとMCPの道具には `TaskContext` を渡します。

HTTP・MCP サーバーと DNS-SD のポートは1〜65535の整数です。DNS-SD の `update(txt)` は名前の確保中も最新の値を保持し、確保後に公開します。STK は2048 bytes以内のJSONを受信し、不正なパケットをエラーとして報告した後も次の受信を続けます。閉じた接続に届く遅延通知はアプリへ渡しません。

`dialogue.ask(text, { signal })` は会話の返事の取得まで待ち、読み上げは `audio.say` で明示します。同時の対話要求は `BUSY`。履歴はResponses APIの応答IDで保持し、1回の `ask` が正常に終わったときだけ更新します。途中の通信失敗・取消・出力や往復回数の上限超過では直前に成功した履歴を維持し、`clear()` で破棄します。入力は4096文字、道具の往復は10回までです。文字起こしは `RecordedAudio` のファイル名と元バッファを使い、大きなmultipartバッファへ録音全体を複製しません。

`monitor` は0〜1のRMS音量、`realtime` の出力レベルも0〜1です。monitorは入力、radioは出力、realtime / remoteは両方を既存のRuntimeAudioで確保します。占有中の別の録音・再生は `BUSY`、解放に失敗した機器は再利用しません。radio / realtimeの開始は接続準備の開始を返し、その後の接続・再生状態はコールバックで観測します。USBの `requestStart` / `requestStop` は要求の受理IDであり、完了は `onState` で確認します。

`motion.position` は最後に観測した `yawDeg` / `pitchDeg` のコピーで、初回観測前は `undefined` です。追加のUART読み取りは行いません。保守操作は設定済みの同じドライバーへ接続し、通常motionを停止して実行します。速度変更は両軸に適用し、再起動まで通常動作を再開しません。保守中の終了は進行中のバス操作を待ちます。SHT3x の標本は `temperatureC` / `relativeHumidityPercent` です。

UI拡張には `setTracking`、`setMusicNotes`、`setFaceMotionEnabled` を追加しました。`setTracking` は左右の目・口の開度0〜1と、手の座標・`rotationDeg`・形を受け取ります。`null` で追跡表示を解除します。機器・Piuの実装オブジェクトは渡さず、終了時の復元も共通の所有処理で行います。

### 設定の正本

設定キーと型は [可搬なschema](../contracts/settings-schema.js) を `stackchan/settings-schema` から再公開します。本体・Web設定・SDKは同じ定義と SettingsService の検証を使い、別のMOD用設定モデルを作りません。`get(key)` は型付きの実値、`describe(key)` は値の由来・readOnly・secret・configured・適用時点を返します。describeのsecret値は伏せます。`set(key, value)` は検証後に保存し、適用時点は戻り値で確認します。

`get` では、そのアプリが必要とするキーを取得できます。通常MODと同じrealmで実行するため、秘密を隔離するsandboxではありません。トークンを吹き出しやログへ出さないでください。設定の優先順位は保存値 → アプリ設定 → プロファイル → 既定値、ボードが固定した値は変更できません。

リアルタイム会話には `chat.type`、`chat.apiKey`、`chat.endpoint`、`chat.modelID`、`chat.voiceID`、`chat.instructions` を使用します。旧 `chat_audioio/config.js` の読み替えは撤去したため、共通設定へ転記してください。`ai.token` / `ai.context` は文字での対話に使います。新しい設定名の追加はschemaから行い、Webや例に独立した既定値を重ねません。

USB 遠隔会話は自動起動・`conversation.remote()` のどちらも、起動中は共通のマイクとスピーカーを占有します。他の録音・再生・会話との競合は `BUSY` です。`await session.close()` で物理入出力を閉じて使用権を返し、前の会話から届く音声要求を拒否します。USB の制御通信は会話停止後も維持します。機器の解放に失敗した場合はエラーを返し、ホストを再起動するまで音声の再利用を止めます。

WASMで未実装の通信・機器は `UNSUPPORTED` です。能力表の `native / simulated / unavailable` と実行時の設定エラーを区別してください。ソース移行と自動検査が終わっても、物理無線・サービス接続・サーボ保存・電源断・初学者による受入は別途必要です。参考providerライブラリーの整理、無線・音声の競合処理と製品コード純減は、引き続き再設計全体の残件です。


## Blocklyと顔エディター（host API 8）

Webの生成コードも `defineApp` とこのSDKを使います。`input(app).onRelease(name, handler)` でボタンを離した操作を受け取り、`input(app).onHeadTouch(handler, { gesture: 'petting' })` で1.5秒以内の往復スワイプを受け取れます。フィルターは処理の重複を抑止する前に適用されます。

`singing(app)`（`stackchan/extensions/audio`）の `sing(bpm, score, options)` は、`[音階, 拍, かな1モーラ]` のリストを歌わせます。休符は `['R', 拍, '']` です。20〜300 BPM、1〜256要素、1音20〜8000 msと変換結果の上限をホストで検証します。音声合成器が非対応なら `UNSUPPORTED`、出力を会話・ラジオが占有していれば `BUSY`、不正な楽譜は `INVALID_ARGUMENT` です。`options.signal` で取り消せます。

`ui(app).setShapeFace(data)` には `stackchan/shape-face` の `ShapeFace` 型に従う領域・目・口のデータを渡します。データは検証して複製され、アプリ終了時に既定の顔へ戻ります。`openMenu()` / `closeMenu()` / `toggleMenu()` / `showFace()` も同じUI拡張です。

`app.motion.hold()` は移動と視線追従を止めて、ドライバーが最後に指示された位置でトルクを有効にします。力を抜いた後に手で位置を変えた場合、最後の指示位置へ戻ることがあります。力を抜く操作は `relax()`、新しい姿勢へ動かす操作は `move()` を使います。

## アプリの設定既定値

host API 9以降では、`stackchan-mod.json` の `settings` に共通設定の既定値を宣言できます。例は `"settings": { "tts.volume": 0.3 }` です。型と値は [共通schema](../contracts/settings-schema.js) で検証し、旧名・未知のキー・不正値・アプリ変更不可のWi-Fi設定は、CLI・Web・SD・WASMのインストール時と本体起動時に拒否します。保存済み設定と機種固定のdriverが優先されます。秘密情報は配布するmetadataへ入れず、本体の設定画面で入力してください。

実行可能な `mod/config` は廃止しました。素材の再生レートはMAUDヘッダーから読み取り、アプリの設定で調整する必要はありません。USB会話は `capabilities: ["conversation.remote"]` の宣言でホストが準備し、`conversation(app).remote()` でアプリの寿命へ接続します。
