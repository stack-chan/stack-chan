# USB dockのMOD駆動遅延起動計画

作成日：2026-07-31

対象：M5StackChan CoreS3向けUSB audio dock、remote conversation capability、Codex Voice MOD。

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

- [ ] USB dock実装を含む`develop`を作業ブランチへ統合する。
- [ ] 既存の通常hostとAndroid USB audio hostをrelease buildする。
- [ ] Firmwareサイズと起動時heapを記録する。
- [ ] Android接続、会話開始、承認表示の既存smoke結果を記録する。

完了条件：機能追加前のサイズと実機動作を、変更後と比較できる。

### 段階2：遅延起動facade

- [ ] `RemoteConversationSession`へ`activationState`、`activate()`、`deactivate()`を追加する。
- [ ] inactive時のstate、要求、購読規則を型とテストで固定する。
- [ ] active runtimeを差し替え可能なfacadeをremote-session層へ追加する。
- [ ] activate失敗時の逆順cleanupを実装する。
- [ ] deactivateとhost closeの二重解放を防ぐ。

完了条件：fake transportだけでinactive、activate、deactivate、reactivateの状態遷移を検査できる。

### 段階3：dock runtimeの分割

- [ ] `StackchanDock.start()`から`startUsbAudioBridge()`の即時呼び出しを除く。
- [ ] `onContextCreated()`でcontextを保持し、activate可能な状態へ遷移させる。
- [ ] `autoStart=true`の場合だけ`onContextCreated()`からactivateする。
- [ ] presentationとtool providerの生成をactive期間へ限定する。
- [ ] `close()`をfacadeの終了処理へ一本化する。

完了条件：`autoStart=false`でbridge factoryが一度も呼ばれず、`autoStart=true`で従来どおり一度だけ呼ばれる。

### 段階4：manifestとCodex MOD

- [ ] 通常のM5StackChan CoreS3 hostへUSB dock moduleをincludeする。
- [ ] 通常hostへ`autoStart=false`を設定する。
- [ ] Android用と診断用manifestへ`autoStart=true`を設定する。
- [ ] 不要であればUSB bridge moduleの`preload`を外す。
- [ ] Codex Voice MODから`activate()`を呼ぶ。
- [ ] MODのactivation失敗をtraceへ残す。

完了条件：同じhost binary上で、通常MODはinactive、Codex Voice MODはactiveになる。

### 段階5：検証と文書更新

- [ ] Node.js unit testで遅延起動とcleanupを検査する。
- [ ] architecture checkでmanifestの`autoStart`方針を検査する。
- [ ] Moddable testでmodule importとworker起動を検査する。
- [ ] 通常host、Android USB audio host、Codex Voice MODをbuildする。
- [ ] CoreS3実機でinactive、Codex接続、Android互換を確認する。
- [ ] Firmware書き込み手順とmanifestの使い分けを更新する。
- [ ] 利用者可視の変更としてrelease impactを判定し、必要ならchangesetまたはrelease noteを追加する。

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
