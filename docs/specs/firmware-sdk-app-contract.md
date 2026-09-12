# MODの常駐処理と画面を分けるSDK契約

SDK再設計では、一つのMODに常駐処理と複数のAppを登録し、顔とmini-appを同じ画面モデルで扱います。
この文書は、後続PRで実装する公開契約を定めます。
実装・移行・検証は[移行計画](../operations/firmware-sdk-milestone.md)の順に進め、各APIを利用できる段階でサンプルと資料を更新します。

[PR #701のレビュー](https://github.com/stack-chan/stack-chan/pull/701#issuecomment-5642984254)では、mini-appの読込や通常の顔画面を維持したまま公開契約を固めること、普通のMOD作者に内部のTaskScopeを要求しないこと、音声デバイスをホストが共有することが求められています。
この契約を確かめるまで、旧APIと既存の配布経路を維持します。

## 一つのMODが常駐処理とApp一覧を持つ

`defineMod({ setup?, apps?, initialApp? })`を通常MODの入口とします。
`setup(app)`はMOD起動時に一度実行し、タイマー、通信、入力購読などの常駐処理を登録します。
`apps`は画面の定義一覧、`initialApp`はその一覧内のApp IDです。
initialAppを省略すると、ホストの顔Appを表示します。

`defineApp`と`defineMiniApp`は共通の`AppDefinition`を返します。
defineMiniAppはmini-app向けの薄いヘルパーとし、独立した画面ライフサイクルを増やしません。

| AppDefinitionの項目 | 契約 |
| --- | --- |
| `id` | MOD内で一意のApp ID |
| `title` | App menuへ表示する名称 |
| `setup(app)` | 任意。表示開始時に処理を登録し、`void`または`Promise<void>`を返す |
| `view: 'face'` | ホストの顔表示とDrawerMenuを使う |
| `create(context)` | Piuの画面を生成する。`view: 'face'`とどちらか一方を指定する |

MODのsetupも`void`または`Promise<void>`を返します。
ホストはMODのsetupが正常に完了するまで待ち、その後にApp一覧の登録・表示準備、初期Appのsetup、画面生成へ進みます。
MODのsetupがthrowまたはPromiseのrejectで失敗した場合は起動を中断し、Appの準備と画面生成を行わず、作成済みの所有者を解放してホストの復旧画面へ戻します。
`mod.onLaunch() === false`による起動中断は旧APIの互換動作に限ります。defineModのsetupでは例外またはrejectで失敗を通知します。

Appのsetupが正常に終わった後に画面を生成します。
初期表示を含め、Appのsetupが失敗した場合はそのAppの所有者を解放し、常駐MODを維持してホストの顔とApp menuへ戻します。
Piuのcreateには`app`、`width`、`height`、`close`を渡し、Containerまたは`{ content, dispose? }`、あるいはそのPromiseを受け取ります。
disposeはその画面固有の後片付けに使い、通常のSDK利用にMODのcloseフックを要求しません。

次は顔を登録し、常駐処理から音声を使う導入後の設計例です。

```js
import { defineApp, defineMod } from 'stackchan'

const face = defineApp({
  id: 'face',
  title: '顔',
  view: 'face',
  setup(app) {
    app.input.onPress('secondary', () => app.ui.openAppMenu())
  },
})

export default defineMod({
  initialApp: 'face',
  apps: [face],
  setup(app) {
    app.input.onPress('primary', async () => {
      await app.audio.say('こんにちは')
    })
  },
})
```

## 画面の終了で、その画面の処理を解放する

MODの常駐処理と、表示中Appの処理には別の所有者を割り当てます。
MOD終了は両方を終了し、画面切替は表示中Appの所有する購読、タイマー、通信、機器操作だけを終了します。
Appのsetupは表示ごとに実行し、再表示では画面を作り直します。
常駐処理の継続が必要な会話や通信は、MODのsetupで登録します。

内部ではMODのセッションを親、Appのセッションを子として管理します。
各appオブジェクトに所有者を結び付け、非同期処理の実行時に共有の「現在のApp」から所有者を推測しません。
顔、DrawerMenu、視線への画面固有の変更は、画面終了時に常駐側の状態へ戻します。
ハードウェア自体はホストが保持します。

画面切替後に古いsetupやcreateが完了しても、その画面を再表示しません。
古い処理が返した資源を解放し、遅延したclose要求で新しい画面を閉じないようにします。
disposeは同じ画面に対して一度だけ呼びます。

## App menuから切り替え、「戻る」はinitialAppへ向ける

`app.ui.openAppMenu()`と`app.ui.openApp(id)`は、戻り値を持たない画面遷移要求です。
App menuを開くだけでは現在のAppを破棄せず、移動先を選んだ時点で切り替えます。
AppBarの「戻る」とcreateへ渡すcloseはinitialAppへ戻します。履歴スタックは持ちません。
遷移中の連続要求は最後の移動先へまとめます。

MODのsetupやApp一覧の登録・表示準備に失敗した場合は、作成済みの所有者を解放してホストの復旧画面へ戻します。
初期表示や画面切替でAppのsetup・createに失敗した場合は、その画面と所有者だけを解放し、常駐処理を維持してホストの顔とApp menuへ戻します。
失敗したAppへ自動で遷移し続けないようにします。

## mini-appの入口とCompartmentを維持する

archiveは`mod`、`miniapp`、両方のentrypointを持つ形式に対応します。
`miniapp`のentrypointは、`AppDefinition`の配列をdefault exportします。単一の定義オブジェクトや名前付きexportだけの形式は受け付けません。
miniapp側の定義も同じApp一覧へ正規化し、一つのarchiveで登録できるAppは最大16個とします。
App IDの重複、初期Appの参照先、定義数は登録前に検査します。

archiveごとのCompartmentを維持します。
SDK、許可されたPiuモジュール、archive内のモジュールを使えるようにし、ホスト内部のモジュールへ直接importさせません。
required capabilityと生成済みの互換情報は、MODを評価する前に検査します。

## appの各機能へ直接アクセスする

公開APIは`app.ui`、`app.settings`、`app.conversation`、`app.audio`、`app.motion`、`app.input`、`app.time`、`app.network`、`app.lighting`、`app.camera`、`app.sensors`へ揃えます。
取得関数や型キャストを経由せずに利用できる形にします。
callbackへ内部のTaskScopeやtask引数を渡すことを必須にせず、個別操作を取り消したい場合だけ標準AbortSignalを任意指定できるようにします。
所有者終了時の取消しと、明示されたAbortSignalの両方を操作へ反映します。

入力IDは`INPUTS as const`から導出した`InputId`とし、`primary`、`secondary`、`tertiary`を提供します。
物理ボタンとの対応は基板側が定義します。
同じボタンについて表示中Appに該当イベントの購読があれば、そのAppへ配送し、なければ常駐MODへ配送します。

```js
const handle = app.input.onPress('primary', async () => {
  await app.audio.say('こんにちは')
})
app.input.off(handle)
```

offは新しい配送と待機中の配送を止め、開始済みのcallbackは完走できるようにします。
所有者が終了した場合には、そのcallbackから開始したSDK操作も内部で取り消します。
onRelease、onHeadTouch、onMotionも同じ購読解除の規則に従います。
ボタンは同じハンドラーの実行中に届いたイベントを破棄する既存動作を保ち、頭のタッチはpetting合成と最大8件の直列配送を維持します。
タッチの待ち行列が満杯なら、最新の入力を残します。

## 音声デバイスをホストが共有する

物理出力はECMA-419のAudioOut一つとし、物理デバイスを開かないMixerへ4本のstreamを用意します。
TTS、Realtime、効果音、WebRadio、USB音声を同じ出力へ接続します。

| stream | 用途 |
| --- | --- |
| 0 | Realtime会話、remote音声 |
| 1 | tone、playClipなどの効果音 |
| 2 | say、singなどの発話 |
| 3 | play、WebRadio、USB音声のメディア |

stream 3ではplay、WebRadio、USB音声の再生要求を直列化し、同時に一つの再生要求へ出力を割り当てます。
USB音声も所有者を持つ再生要求として扱い、停止・切断で自分の未混合データを破棄してstreamを明け渡します。
他の所有者の待機要求は維持し、共有FIFO内の混合済みデータが再生済みになってから停止を完了します。

共通のPCM形式は48 kHz、16 bit、monoとし、入力素材の形式はデコードとリサンプリングで揃えます。
会話中でもToolから効果音を鳴らせるようにし、会話が出力全体をBUSYとして占有しない構成にします。
取消し、停止、flushは対象の所有者とstreamへ限定し、別の系統のキューや物理出力を閉じません。
すでに混合して共有FIFOへ渡したサンプルは再生済みになるまで管理し、停止完了を早く通知してバッファを解放しないようにします。

入力デバイスは排他的に使います。
半二重の基板では再生に合わせてcaptureを一時停止・再開し、会話のネットワーク接続を維持します。
WASMにも同じ所有、キュー、取消しの規則を適用します。

## motionの実測判定はドライバー特性に従う

`positionToleranceDeg`をドライバーの特性として持ち、既定値を2°とします。
yawとpitchが両方とも許容範囲内に入ったことを、連続2回の位置読取で確認してmeasuredを返します。
途中で許容範囲から外れれば、連続回数を数え直します。
実測できないPWMなどはestimatedを返し、機械的な可動範囲と到達判定の許容値を分けます。

## 作者のmetadataと生成情報を分ける

作者が書くmetadataは`id`、`version`、`requires`、`optional`を基本とし、設定やGallery向けの情報は必要に応じて追加します。
`targets`を省略した場合は機種非限定とし、portable属性は設けません。
optional capabilityに由来する機器を、起動の必須条件へ繰り上げません。

ツールはschema世代、App API世代、最低host API世代、推移的依存、XS互換情報を生成します。
CLIとWebで同じ生成・検査処理を使います。
新契約はschema 3／App API 3を用い、host APIの世代は各段階で実装済みの能力に合わせて更新します。
将来の機能を先行して利用可能と宣言しません。

移行中の旧APIは同じサービス実装へ接続する薄いアダプターとして残します。
既知の旧形式は旧loaderで扱い、不正な新形式やrequired capabilityの不足を旧経路へ迂回させません。
旧APIの撤去は、教材、サンプル、既定動作、コード生成、配布、復旧の移行を確かめた後に行います。
