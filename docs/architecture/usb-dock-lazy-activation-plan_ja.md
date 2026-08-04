# USB dockのMOD駆動遅延起動計画

作成日：2026-07-31（Asia/Tokyo）

対象：M5StackChan CoreS3向けUSB audio dock、remote conversation capability、Codex Voice MOD。

> 2026-08-02のCoreS3実機検証で、USB bridge全体の遅延起動は撤回した。
> 本文は当初の設計判断を残しており、現行設計との差分は末尾の「実機検証後の設計改修」に記録する。

## 目的

M5StackChan CoreS3の通常hostへUSB dock通信機能を組み込みながら、MODが明示的に要求するまでUSB bridgeを起動しない構成へ変更する。

通常MODではworker、マイク、スピーカー、EVENT transport、USB状態表示を起動しない。

Codex Voice MODでは、`onContextCreated()`から通信を有効化し、音声会話を開始していないstandby状態でも承認要求を受信できるようにする。

既存のAndroid USB audio用hostは、起動直後に通信を開始する互換動作を維持する。

## 実装前提

この計画は、USB dock実装を含む`develop`を作業ブランチへ統合した状態を基準とする。

統合後に、少なくとも次の実装が存在することを確認する。

- `firmware/host/app/docks/android-usb-audio/dock.ts`
- `firmware/host/app/remote-session/`
- `firmware/host/modules/usb-audio/`
- `firmware/host/app/manifest_android_usb_audio.json`
- `firmware/mods/examples/codex_voice/`

既存のUSB dockは、`usbAudio.enabled=true`のときにhost起動中の`StackchanDock.start()`から`startUsbAudioBridge()`を呼ぶ。

この呼び出しはworkerとUSB transportを開始し、remote sessionを作成するため、モジュールの組み込みと通信開始が同じ段階に置かれている。

Codex Voice MODは既に作成された`robot.conversation.remoteSession`を利用するだけで、dockを起動するAPIを持たない。

## 対象範囲

この変更では、次の動作を実装する。

- 通常hostにUSB dockとremote sessionのモジュールを組み込む。
- host起動時には、通信開始に必要な軽量な制御オブジェクトだけを作る。
- MODからの`activate()`でUSB bridgeとremote session runtimeを作る。
- `deactivate()`またはhost終了時に、作成したリソースを一度だけ解放する。
- Android USB audio用manifestでは、従来どおり自動的に`activate()`する。
- Codex Voice MODでは、購読設定より前に`activate()`する。

この変更では、次の項目を扱わない。

- USB CDC v2のwire形式変更。
- USB接続を使ったMODの自動判定。
- ESP32-S3のUSB Serial/JTAGデバイス自体を非表示にする処理。
- 実行中MODを再起動なしで差し替える新しいライフサイクル。
- 複数種類のdockを同時に選択する汎用レジストリ。

## 守るべき動作

**inactive**は、USB dockモジュールがFirmwareへ組み込まれているが、bridgeを開始していない状態とする。

inactiveでは、次の条件を満たす。

- `stackchan-usb-audio`を実行時importしない。
- USB audio workerを生成しない。
- `AudioIn`と共有`AudioOut`を取得しない。
- HELLOとHELLO_ACKを含むdock protocolを処理しない。
- 承認画面とUSB状態表示を追加しない。
- 通常の顔、サーボ、タッチ、音声機能の動作を変えない。

**active**は、USB bridge、remote session runtime、状態表示を作成し、dock protocolを処理できる状態とする。

activeでは、音声会話を開始していないstandby状態でも`approval.request`を受信しなければならない。

`/dev/ttyACM0`の列挙はESP32-S3のUSB Serial/JTAG機能によるため、inactiveの保証対象に含めない。

## 公開API

既存の`RemoteConversationSession`を安定した遅延起動facadeとして維持する。

transport固有の`usbAudio`をMOD公開APIへ出さず、remote conversationのライフサイクルとして有効化する。

APIの候補は次の形とする。

```ts
export type RemoteConversationActivationState = 'inactive' | 'active'

export type RemoteConversationSession = {
  readonly activationState: RemoteConversationActivationState
  readonly state: RemoteConversationState
  readonly lastError?: string
  readonly transportState: RemoteConversationTransportState

  activate(): void
  deactivate(): void
  requestStart(): string
  requestStop(): string
  subscribe(listener: RemoteConversationListener): () => void
  subscribeTransport(listener: RemoteConversationTransportListener): () => void
}
```

`activationState`と`transportState`は区別する。

`activationState='inactive'`では`transportState='disconnected'`を返し、既存のtransport state unionへ新しい値を追加しない。

inactiveで`requestStart()`または`requestStop()`を呼んだ場合は、要求を保留せず、sessionがinactiveであることを示す例外を投げる。

`activate()`と`deactivate()`は冪等にする。

一度`deactivate()`した後の再`activate()`を許可し、USB切断試験とMOD開発時の再試行に利用できるようにする。

## host内部のライフサイクル

`StackchanDock.start()`はUSB bridgeを開始せず、遅延起動facadeを含む`StackchanDockRuntime`を返す。

hostはfacadeを`createStackchanContext()`へ渡すため、MODの`onContextCreated()`から`robot.conversation.remoteSession`を参照できる。

`StackchanDockRuntime.onContextCreated()`は`StackchanContext`とtool providerを保持するが、`autoStart`が無効ならbridgeを開始しない。

`activate()`は次の順序で処理する。

1. `onContextCreated()`が完了し、contextを利用できることを確認する。
2. `Modules.importNow('stackchan-usb-audio')`でbridge factoryを取得する。
3. `startUsbAudioBridge()`でbridgeを作る。
4. `createRemoteSessionRuntime()`でconversationとapprovalのsessionを作る。
5. remote session runtimeへcontextとtool providerを設定する。
6. status handlerとpresentationをbridgeへ設定する。
7. facadeの委譲先をruntimeへ切り替え、`activationState='active'`にする。

手順2から6の途中で失敗した場合は、生成済みのpresentation、remote session runtime、bridgeを逆順で閉じる。

失敗時はfacadeをinactiveへ戻し、呼び出し元へ例外を返す。

このロールバックにより、部分的に起動したworkerやAudioOutが次の再試行を妨げる状態を残さない。

`deactivate()`は次の順序で処理する。

1. facadeをinactiveへ遷移させ、新しい会話要求を拒否する。
2. status handlerとpresentationをbridgeから外す。
3. presentationを閉じる。
4. remote session runtimeを閉じる。
5. bridgeを閉じる。
6. active runtimeへの参照を破棄する。

hostの`lifecycle.close()`は、MODが`deactivate()`を呼んでいない場合でも同じ解放処理を一度だけ実行する。

## facadeの委譲規則

facadeはactive runtimeを作り直しても同じオブジェクトを維持する。

この規則により、`StackchanContext`の再生成やMOD側の参照差し替えを不要にする。

inactive中に登録された`subscribe()`と`subscribeTransport()`のlistenerはfacadeが保持する。

activate後はfacadeがactive runtimeを購読し、受け取った状態を既存listenerへ配布する。

deactivate時は、conversation stateを`standby`、transport stateを`disconnected`へ戻してからlistenerへ通知する。

pendingなconversation要求はactive runtimeの`close()`で破棄する。

pendingなCodex承認要求はPC側が所有するため、Firmwareのdeactivateだけで`decline`へ変換しない。

PC側はUSB切断と同様に要求を保持し、再activateまたは別のCodex clientによる解決を待つ。

## manifest構成

通常のM5StackChan CoreS3 manifestへ、dock adapterとUSB audio moduleをincludeする。

通常hostの設定は次の値を基準とする。

```json
{
  "config": {
    "usbAudio": {
      "enabled": true,
      "autoStart": false,
      "speakerVolume": 0.25
    }
  }
}
```

`enabled`はFirmwareに組み込んだcapabilityを利用可能にする設定として維持する。

`autoStart`はhost起動時にMODの指示を待たずactivateするかを表す。

既存の`manifest_android_usb_audio.json`では`autoStart=true`を指定し、Android dock appの互換動作を維持する。

診断manifestも自動接続を前提とするため、`autoStart=true`を明示する。

USB module manifestの`preload`は削除候補とする。

`Modules.importNow()`だけでworkerを含む全moduleを解決できることをbuildと実機で確認し、起動時preloadが不要なら削除する。

Moddableのmodule解決上preloadが必要な場合でも、module評価によってworkerやAudioInを開始しないことをテストで固定する。

## Codex Voice MOD

Codex Voice MODは`onContextCreated()`の冒頭でremote sessionをactivateする。

activateが成功した後にconversation state、transport state、タッチgestureを購読する。

```js
export function onContextCreated(robot) {
  const remoteSession = robot.conversation.remoteSession
  if (!remoteSession) {
    trace('[codex-voice] USB remote conversation capability is unavailable\n')
    return
  }

  try {
    remoteSession.activate()
  } catch (error) {
    trace(`[codex-voice] activation failed: ${String(error)}\n`)
    return
  }

  // 既存のsubscribeとgesture設定を続ける。
}
```

Codex MODのロード直後にactivateする理由は、承認要求が音声会話の開始とは独立して届くためである。

最初の前方スワイプまでactivateを遅らせると、standby中の承認UIを表示できない。

## 通常hostのサイズ判定

USB audio worker、event parser、remote session、presentationを通常hostへ追加すると、flashとRAMの使用量が増える。

実装着手時に、機能追加前の通常hostとUSB module組み込み後の通常hostを同じrelease条件でビルドし、次の値を記録する。

- app partitionに対するFirmware binaryの残容量。
- XS heapの起動直後空き容量。
- inactive時のworker数。
- inactive時のAudioInとAudioOutの所有状態。
- active後とdeactivate後のheap差分。

通常hostがpartitionへ収まらない場合は、機能を削って無理に収めない。

その場合は`manifest_m5stackchan_cores3_dock_capable.json`を追加し、通常動作を保ちながらUSB moduleを組み込んだ配布targetを分ける。

この代替targetでも`autoStart=false`を維持し、Codex MODからのactivateで通信を開始する。

## 実装段階

### 段階1：基準とサイズの固定

- [x] USB dock実装を含む`develop`を作業ブランチへ統合する。
- [x] 既存の通常hostとAndroid USB audio hostをrelease buildする。
- [ ] Firmwareサイズと起動時heapを記録する。
- [ ] Android接続、会話開始、承認表示の既存smoke結果を記録する。

完了条件：機能追加前のサイズと実機動作を、変更後と比較できる。

### 段階2：遅延起動facade

- [x] `RemoteConversationSession`へ`activationState`、`activate()`、`deactivate()`を追加する。
- [x] inactive時のstate、要求、購読規則を型とテストで固定する。
- [x] active runtimeを差し替え可能なfacadeをremote-session層へ追加する。
- [x] activate失敗時の逆順cleanupを実装する。
- [x] deactivateとhost closeの二重解放を防ぐ。

完了条件：fake transportだけでinactive、activate、deactivate、reactivateの状態遷移を検査できる。

### 段階3：dock runtimeの分割

- [x] `StackchanDock.start()`から`startUsbAudioBridge()`の即時呼び出しを除く。
- [x] `onContextCreated()`でcontextを保持し、activate可能な状態へ遷移させる。
- [x] `autoStart=true`の場合だけ`onContextCreated()`からactivateする。
- [x] presentationとtool providerの生成をactive期間へ限定する。
- [x] `close()`をfacadeの終了処理へ一本化する。

完了条件：`autoStart=false`でbridge factoryが一度も呼ばれず、`autoStart=true`で従来どおり一度だけ呼ばれる。

### 段階4：manifestとCodex MOD

- [x] 通常のM5StackChan CoreS3 hostへUSB dock moduleをincludeする。
- [x] 通常hostへ`autoStart=false`を設定する。
- [x] Android用と診断用manifestへ`autoStart=true`を設定する。
- [x] 不要であればUSB bridge moduleの`preload`を外す。
- [x] Codex Voice MODから`activate()`を呼ぶ。
- [x] MODのactivation失敗をtraceへ残す。

完了条件：同じhost binary上で、通常MODはinactive、Codex Voice MODはactiveになる。

### 段階5：検証と文書更新

- [x] Node.js unit testで遅延起動とcleanupを検査する。
- [x] architecture checkでmanifestの`autoStart`方針を検査する。
- [ ] Moddable testでmodule importとworker起動を検査する。
- [x] 通常host、Android USB audio host、診断host二種、Codex Voice MODをrelease buildする。
- [ ] CoreS3実機でinactive、Codex接続、Android互換を確認する。
- [x] Firmware書き込み手順とmanifestの使い分けを更新する。
- [x] 利用者可視の変更としてrelease impactを判定し、必要ならchangesetまたはrelease noteを追加する。

完了条件：自動テストと実機受入条件をすべて満たし、利用者がhostとMODの組み合わせを選べる。

## テスト計画

### unit test

遅延起動facadeとdock runtimeに、次のケースを追加する。

- `autoStart=false`ではdock作成とcontext設定だけでbridgeをimportしない。
- 最初の`activate()`でbridgeとruntimeを一度だけ作る。
- 二回目の`activate()`は新しいworkerを作らない。
- inactiveの`requestStart()`と`requestStop()`は即座に失敗する。
- inactiveで登録したlistenerがactivate後の状態を受け取る。
- `deactivate()`がpresentation、runtime、bridgeを一度ずつ閉じる。
- 二回目の`deactivate()`は何もしない。
- deactivate後のactivateで新しいruntimeを作れる。
- bridge生成失敗とruntime生成失敗で部分リソースを残さない。
- host closeとdeactivateが重なっても二重closeしない。
- `autoStart=true`ではcontext作成後にbridgeを開始する。

Codex Voice MODには、fake remote sessionを使って次の動作テストを追加する。

- capabilityが無い場合はactivateしない。
- activateを購読とgesture登録より先に呼ぶ。
- activate失敗時はgesture handlerを登録しない。
- activate成功後は前方スワイプと後方スワイプを既存要求へ変換する。

### buildと静的検査

`firmware/`から次のコマンドを実行する。

```sh
npm run format
npm run lint
npm run test:unit
npm run check:architecture
npm run check:manifest
npm run build:m5stackchan_cores3
npm run build:android-usb-audio
npm run mod:build -- mods/examples/codex_voice/manifest.json --mode=release
```

通常hostがpartition上限へ近づく場合は、release binary sizeをCIで上限検査する。

### CoreS3実機

通常MODを導入した状態で、次の条件を確認する。

- 起動後にUSB bridgeの開始traceが出ない。
- PCからHELLOを送ってもdock protocolのHELLO_ACKを返さない。
- マイクとスピーカーをdock workerが取得しない。
- 顔、サーボ、タッチ、既存音声が従来どおり動作する。

Codex Voice MODを導入した状態で、次の条件を確認する。

- MODロード後にUSB bridgeが一度だけ起動する。
- Codex dock serviceがHELLO_ACKとEVENT capabilityを受信する。
- 音声会話を開始していないstandby状態で承認要求を表示する。
- 画面のOKをCodexの`accept`、NGを`decline`として一度だけ返す。
- 前方スワイプで会話を開始し、後方スワイプで停止する。
- USB抜線と再接続後に未解決の承認画面を復元し、会話状態はstandbyから再開する。

Android USB audio用hostで、次の互換条件を確認する。

- MODからactivateしなくても起動直後にHELLO_ACKを返す。
- Android dock appのマイク、スピーカー、状態表示、承認UIが動作する。
- `presentationEnabled=false`の診断hostでは画面表示だけを作らない。

## 受入条件

- 通常hostはUSB dock moduleを含むが、通常MODではUSB bridgeを開始しない。
- Codex Voice MODは明示的なactivateによってUSB bridgeを開始する。
- Codex承認UIは会話開始前のstandby状態でも利用できる。
- Android USB audio用manifestの自動開始に回帰がない。
- activate、deactivate、host closeの全経路でworker、AudioIn、AudioOut、presentationをリークしない。
- 通常hostがpartitionと起動時heapの許容範囲へ収まる。
- 通常hostへ収まらない場合は、dock-capable targetを分離し、通常hostの配布を壊さない。

## PRの分割

実装は次の三つのPRへ分ける。

1. remote sessionの遅延起動facade、状態遷移、unit test。
2. USB dock runtimeの遅延起動、manifest設定、Android互換テスト。
3. 通常hostへの組み込み、Codex Voice MODのactivate、実機結果、利用者向け文書。

PR 1はhardwareへ依存しない状態機械としてレビューできる。

PR 2は既存Android経路の互換性を固定する。

PR 3はFirmwareサイズと実機結果を確認した後に、通常配布へ含めるかdock-capable targetへ分けるかを確定する。

## 実装結果

実装基点は`origin/develop`の`c25bba5273dbdb23cc0bcc29b7df9494365272c5`である。

作業ブランチは`feat/usb-dock-lazy-activation`である。

通常のM5StackChan CoreS3 hostはUSB dock moduleを含み、`autoStart=false`で起動する構成になった。

Android USB audio hostと診断host二種は`autoStart=true`を明示し、従来の自動開始方針を維持した。

Codex Voice MODはremote sessionの購読とgesture登録より先に`activate()`を呼び、activationに失敗した場合は後続処理を行わない。

### 自動検証

- `npm run format`は631ファイルを検査して成功した。
- `npm run lint`は成功し、既存の`noUselessConstructor`情報メッセージが一件残った。
- `npm run check:architecture`は73件すべて成功した。
- `npm run check:manifest`は6ターゲットすべて成功した。
- `python -m unittest scripts/test_usb_audio_diagnostics.py`は9件すべて成功した。
- Moddable test suiteは37 manifestすべて成功した。
- 通常host、Android USB audio host、診断host二種、Codex Voice MODのrelease buildはすべて成功した。

`npm run test:unit`は77件中76件が成功した。

失敗した`firmware/scripts/lib/firmware-command.test.mjs`の一件は、変更前から同じ実行環境で再現する子プロセスstdout取得の問題である。

今回追加したfacadeとdock runtimeのunit testはすべて成功した。

### Firmwareサイズ

| 対象 | 変更前 | 変更後 | app partition空き |
| --- | ---: | ---: | ---: |
| 通常M5StackChan CoreS3 host | `0x5b6530` | `0x5d0830` | `0x9bf7d0`（63%） |
| Android USB audio host | `0x5d5640` | `0x5d0830` | `0x9bf7d0`（63%） |
| Android USB audio診断host | 未計測 | `0x5d0840` | `0x9bf7c0`（63%） |
| Android USB audio診断no-UI host | 未計測 | `0x5d0850` | `0x9bf7b0`（63%） |

通常hostは107,264バイト増加した。

変更後の通常hostは変更前のAndroid USB audio hostより19,984バイト小さく、app partitionには63%の空きがあるため、dock-capable targetは分離しなかった。

### 未実施の受入確認

実機へのFirmware書き込みは実施していない。

このため、起動時heap、inactive時のworkerとAudio入出力の非取得、HELLO_ACKの不応答、Codex承認UI、USB再接続、Android dock appとの実機互換性は未確認である。

Node.jsのfakeを使ったtestではinactive時にUSB module importとbridge factory呼び出しが発生しないことを確認したが、実機workerの未起動は確認していない。

## 実機検証後の設計改修

2026-08-02にCoreS3（USB serial `44:1B:F6:E2:99:A4`）でrelease buildを比較した。

遅延起動を含む`505f8f81`では、Dock serviceが8秒間HELLOを再送してもHELLO_ACKを受信しなかった。

同じ端末、ケーブル、Dock service、Codex Voice MODのまま、遅延起動導入前の`c25bba52`へ戻すと、service起動から4秒後にHELLO_ACK、Codex app-server接続、初期EVENT送信まで成功した。

USBSerialのnative driverは、RX ringに32 KiB、TX ringに16 KiBの内部RAMを確保する。

遅延起動版はWi-Fi、UI、runtime contextの構築後にこの48 KiBを要求するため、起動時より内部RAMが断片化した段階でdriver installに失敗する。

xsdbもUSB Serial/JTAG driverを所有するため、xsdb接続中に観測したdriver install失敗だけではrelease動作の原因を確定できない。

release build同士のA/B比較が、初期化順序だけでHELLO応答の成否が変わることを示した。

現行設計では、物理USBブリッジを`StackchanDock.start()`で一度だけ作り、host終了まで所有する。

application EVENT runtimeも同じ時点で作り、contextとMODの準備より先にraw EVENT handlerとtask sessionを登録する。

物理ブリッジのHELLOはcontext作成より先に成立し得るため、EVENT runtimeまでactivation期間へ限定すると、最初の`task.status`を失う競合が生じる。

EVENT runtime内のtask sessionは最新状態をsnapshotとして保持する。

raw Realtime eventで`session.created`を受信しても、activeなtool providerが存在しない間は`session.update`とfunction callを処理しない。

`activate()`はconversation session、approval session、対応するapplication event handlerを新しく作り、contextとtool providerをそのactivationだけに関連付ける。

その後にstatus handler、presentation、task state listenerを設定する。

`deactivate()`はstatus handler、presentation、task state listenerに加えて、conversation session、approval session、tool providerとそのhandlerを外すが、raw EVENT runtime、task session、物理USBブリッジは閉じない。

inactive中に更新されたタスク状態は、次のactivate時にpresentationへ即時再送する。

再activateは同じraw EVENT runtime、task session、bridge、USBSerial driverを再利用し、会話・承認sessionとtool providerだけを作り直す。

hostの`lifecycle.close()`はfacade、EVENT runtime、物理ブリッジの順に一度だけ閉じる。

`autoStart`は物理USBブリッジやEVENT受信器の起動可否ではなく、context作成後に会話facadeとpresentationを自動activateするかを表す。

この変更により、通常hostでもworkerとUSBSerialの固定コストは起動時に発生する。

AudioInとAudioOutは実際のmedia controlに応じて開くため、inactive中には取得しない。

標準hostのUSB再生音量は固定値を持たず、起動設定が保存する`tts.volume`を使用する。

物理ブリッジは起動設定より先に作るため、保存済み音量を初期値として渡し、context作成時に設定を再読込してworkerへ更新する。

これにより、同じbootの起動設定画面で変更した音量もCodex VoiceのUSB再生へ反映する。

診断manifestの`usbAudio.speakerVolume=0`は明示overrideとして扱い、保存済み音量にかかわらず無音を維持する。
