# USB Dock整合性レビュー

## 対象

このレビューは、Firmwareの`feat/android-usb-audio`とDockの追跡済みHEADを比較し、両リポジトリの修正責務を整理した記録である。
以下の`e12542a0`は比較を実施した時点の履歴であり、現在vendorしている正本revisionではない。

- **Firmware**：`stack-chan/stack-chan`の`feat/android-usb-audio`（同期前HEAD `403c36e7`と作業中の修正）
- **Dock（比較時点）**：`meganetaaan/stack-chan-dock`の`agent/restructure-stack-chan-dock`（HEAD `e12542a0cf351b3944736b3a6416e6f680d36f21`）
- **Dock（現在のvendor元）**：revision `ab30e10aec7ddc2531f9a860ce0accfd5cd0497a`

Dock側の未コミット変更は比較対象に含めていない。
実機USB試験も、このレビューの比較時点では実行していない。

## 合意した判定

Firmware側レビューの主要指摘は妥当であり、比較時点のDock HEAD `831cb8f`ではAndroidのEVENT能力交渉が成立していなかった。
レビュー記載から漏れていた冪等化、送信抑止、不正JSONの継続処理もDock側の修正対象とする。
Dock HEAD `e12542a`ではこれらの修正と共有fixtureの追加が取り込まれている。

| 項目 | 判定 | 担当 |
| --- | --- | --- |
| AndroidでEVENT bit 10を広告 | 修正必須 | Dock |
| application eventとraw Realtime eventの分離 | 修正必須 | Dock |
| `conversation.start/stop/result`対応 | 修正必須 | Dock |
| `requestId`による直近64件の冪等化 | 修正必須 | Dock |
| EVENT非対応Firmwareへの送信抑止 | 修正必須 | Dock |
| 不正JSONで受信collectorを終了させない | 修正必須 | Dock |
| HELLOとEVENTの統合テスト | 修正必須 | Dock |
| 共有fixture拡張 | 推奨 | Dock |
| 接続とEVENT対応状態の三値公開 | 修正必須 | Firmware |
| `sendEvent()`の黙示的な破棄を廃止 | 修正必須 | Firmware |
| Dock正本vectorの固定と同期 | 修正必須 | Firmware |
| `android-usb-audio`の改名 | 今回は見送り | Firmware |

## 確認した不整合

比較時点のDock HEAD `831cb8f`のAndroid実装は、HELLOでEVENT bit 10を広告していなかった。
一方、Realtime sessionは接続準備後に`session.created`をEVENTとして送信していた。

FirmwareはpeerがEVENTを広告していない場合、受信EVENTを`INVALID_REQUEST`として拒否する。
FirmwareからAndroidへ送るEVENTも利用不可になるため、次の経路で`session.update`まで到達しない。

```text
Android HELLO: EVENTなし
→ Firmware HELLO_ACK: EVENTあり
→ Android: session.createdを送信
→ Firmware: INVALID_REQUEST
→ Firmware: session.updateは送信しない
```

EVENTの利用可否は、双方のcapabilityをANDで評価する。
ローカルとpeerのEVENT有無を全列挙すると、利用可能になるのは双方がEVENTを広告した1通りだけである。

| Firmware EVENT | Dock EVENT | Firmwareの公開状態 |
| --- | --- | --- |
| なし | なし | `unsupported` |
| なし | あり | `unsupported` |
| あり | なし | `unsupported` |
| あり | あり | `ready` |

物理的にUSBが接続されていない場合は、capabilityの組み合わせにかかわらず`disconnected`とする。

## Dock側の修正

Dock側はapplication eventをCodex Dock実装と同じ規則で処理する。

- `schema`がないJSONはraw Realtime eventとして処理する。
- `schema == "stackchan.event.v1"`はapplication eventとして処理する。
- 共通schemaを持つ未知または不正なeventは拒否し、raw Realtime eventへフォールバックしない。
- 同一`requestId`には直近64件の保存済み`conversation.result`を返し、操作を再実行しない。
- EVENT非対応peerには`session.created`を送らず、音声機能だけを継続する。
- 壊れたJSONまたは未知eventを受信してもcollectorを継続する。

Android上の`conversation.start`は、モデルとPiperの準備が完了していればautomatic conversationを開始する。
開始済みなら成功として扱い、push-to-talk設定は変更しない。
準備不足の場合は`success=false`、`state="blocked"`と理由を返す。
`conversation.stop`は会話モードにかかわらず停止し、未起動でも成功とする。

Dock側では、HELLOの能力交渉、EVENT非対応peerへの送信抑止、raw eventとapplication eventの分岐、64件の冪等化、不正JSON後の継続処理を統合テストで固定する。

## Firmware側の修正

Firmwareは接続状態を`disconnected`、`unsupported`、`ready`の三値で公開する。
ESP-IDFの`usb_serial_jtag_is_connected()`でUSB SOFを検出するため、USB Serial/JTAGのCDCポートを開いていないホストでも物理接続を判定できる。
このAPIにはFreeRTOSの各tickへ小さな追加負荷がある。

HELLO前またはEVENT非対応peerとの接続は`unsupported`である。
双方がEVENT bit 10を広告した場合だけ`ready`へ遷移する。
USB切断時はpeer capability、EVENT codec、parser、送信queue、マイクsession、スピーカーsessionを初期化する。

Worker境界の`sendEvent()`は、request IDで応答を対応付け、`queued`、`disconnected`、`unsupported`のいずれかをPromiseで返す。
EVENTのencode失敗またはWorker内部エラーはPromiseをrejectする。
bridgeを閉じた場合は保留中の送信を`disconnected`で解決し、未解決Promiseを残さない。

`robot.conversation.remoteSession`は`transportState`と`subscribeTransport()`を公開する。
EVENT非対応時の`requestStart()`と`requestStop()`はrequest IDを返し、frameを送信せず、timerも作らずに会話状態を`blocked`へ遷移させる。
USB未接続時は同じrequest IDを最大10秒間保持し、`ready`へ遷移した時点で即時送信する。
10秒以内に利用可能にならない場合は従来どおり`blocked`へ遷移する。

raw Realtime eventは送信Promiseを直列化し、function outputと`response.create`の順序を維持する。
transportが`ready`以外へ遷移した場合はAndroidの`session.created`受信済み状態を破棄し、再接続後の新しい`session.created`を待つ。
`session.update`の`event_id`をAndroidの`session.updated`と照合し、反映確認済みのprovider世代に対するfunction callだけを実行する。
`session.update`が送信queueのoverflowなどで未配信の場合は、同じprovider・transport leaseが有効な間、同一eventを非ブロッキングで再送する。
function callの`stackchan_session_update_id`も同じIDと照合し、provider更新前に開始したAndroid応答が更新後に生成した遅延callを破棄する。
承認応答の送信失敗は明示的に処理し、未処理のPromise rejectionを発生させない。

## Dock正本vector

FirmwareはDockの追跡済み正本を`vendor/stack-chan-dock`へ内容を変えずに取り込む。
出典とSHA-256は`vendor/stack-chan-dock/VENDOR_SOURCE.json`に記録する。

- **Dock revision**：`ab30e10aec7ddc2531f9a860ce0accfd5cd0497a`
- **LICENSE SHA-256**：`1d291f59c29098471171a78eaba979c38fa58b8bf60d5b330b862f289ecfd8c2`
- **test-vectors.json SHA-256**：`1e2c31c5981e1a963a1c85b89241da1a11e8a6e1b8316ea644f237f8ca0506c0`
- **negotiation-vectors.json SHA-256**：`63a70846df8a5d8651c9c3ee01e96064aef1749563c9abbf01d2767466eb7da7`
- **application-event-vectors.json SHA-256**：`1b4ff73439d6bab2288e5d2efda15196f889f894c4c4a7e55f83de4dbb3234d3`

同期スクリプトはDockリポジトリのHEADを取得し、`LICENSE`または3つのfixtureに未コミット変更があれば停止する。
対象外の未追跡ファイルは同期を妨げない。

Dock正本のvalid frame 3件とCRC不正frame 1件は、TypeScript codecとPython diagnostics codecの双方へ直接入力する。
Firmware固有のfragmentation、coalescing、再同期、EVENT sequence mismatchは`parser-scenarios-v2.json`へ分離する。
これにより、byte単位のgolden値をFirmware側の別fixtureやunit testへ複製しない。

`negotiation-vectors.json`と`application-event-vectors.json`はDockで正本としてcommitされたため、Firmwareへ無改変でvendorする。
Firmwareの能力交渉と会話EVENTのunit testは、この共有fixtureを直接入力する。

## 今回の対象外

`android-usb-audio`の改名は、既存manifestとnpm scriptの互換性へ影響するため今回実施しない。
Dock側のAndroid実装も、このFirmwareセッションでは変更しない。

## 検証

能力交渉は2つのEVENT bitの全4組を列挙し、AND条件だけが1組を`ready`にすることを検査する。
negative controlとしてOR条件を使うと、片側だけがEVENTを広告する2組が反例になることも固定する。

Firmwareのunit testは、transport状態遷移、未接続時のrequest ID保持、非対応時の即時`blocked`、10秒timeout、送信Promiseの対応付けとclose時の解決、Dock正本vectorを検査する。
実機USB試験を実行していない場合は、ビルド結果と分けて報告する。
