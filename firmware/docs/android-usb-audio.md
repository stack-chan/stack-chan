# Android USB Audio Dock

**Stackchan Dock**は、外部機器を接続してｽﾀｯｸﾁｬﾝの能力を追加する任意拡張である。
Android USB Audio DockはAndroid端末をUSB側の制御主体とし、M5Stack CoreS3のマイクとスピーカーを音声対話に使用する。
USB Serial/JTAGのCDC経路を使うため、音声通信中はxsbugを同じポートへ接続しない。

## ビルドと書き込み

以降のコマンドは、リポジトリルートから`firmware/`へ移動して実行する。
Moddable SDKとESP-IDFの環境を読み込む。

```bash
cd firmware
source "$HOME/.local/share/xs-dev-export.sh"
npm ci
npm run build:android-usb-audio
npm run flash:android-usb-audio
```

専用manifestは`host/app/manifest_android_usb_audio.json`である。
このmanifestは標準CoreS3構成を読み込み、`config.usbAudio.autoStart=true`でUSB dockを自動起動する。
通常再生時の`AudioOut.volume`は、起動設定で保存した`tts.volume`を使う。
DockはUSB物理ブリッジの起動時に保存値を読み、起動設定の終了後に再読込して同じboot中の変更も反映する。
診断manifestは明示的な`config.usbAudio.speakerVolume=0`を優先し、無音を維持する。
標準CoreS3 manifestにもUSB dockは組み込まれるが、`autoStart=false`であるためMODが`activate()`するまで論理セッションを起動しない。
標準CoreS3 manifestでも、USBSerialとworkerを含む物理USBブリッジはhost起動時に一度だけ確保する。
application EVENT runtimeもhost起動時に作り、MOD有効化前に届いたタスク状態を保持する。
この常駐runtimeが所有するのはraw EVENT transportとタスク状態のsnapshotだけである。
Androidから`session.created`が先に届いても、MODが`activate()`して実際のtool providerを渡すまでは`session.update`を送らない。
会話session、承認session、tool provider、会話状態ハンドラ、状態表示はactivationごとに作成し、`deactivate()`で破棄する。
`flash:android-usb-audio`は書き込み後にserial monitorを起動せず、CDCポートをAndroid向けに解放する。
ビルドコマンドは、通常版と診断版のmanifestを切り替えた場合に同じtargetの生成物を自動消去してから再構築する。
これにより、直前に使ったmanifestの音量や診断capabilityが残らない。

生成物はリポジトリ内の`dist/bin/esp32/m5stackchan_cores3/release/stack-chan-host`へ出力される。

## Dockの構成

共通の`main.ts`は`stackchan-dock`が登録されている場合だけDockを開始する。
M5StackChan CoreS3用manifestは、このモジュール名をUSB Dock実装へ割り当てる。
共有host manifestとWASM版はUSB transport、remote session、承認画面をbundleしない。

標準CoreS3 hostの`robot.conversation.remoteSession`は、会話表示をまだ有効化していないinactive状態から始まる。
USB機能を使うMODは、状態購読や会話要求より前に`remoteSession.activate()`を呼ぶ。
`activate()`は冪等であり、成功後の`activationState`は`active`になる。
`deactivate()`はactivationが所有する`conversation.stop`をdata channelへ先にqueueし、会話状態ハンドラと状態表示の購読を外して、同じfacadeを再びactivateできる状態へ戻す。
application EVENT runtimeと物理USBブリッジは再activateでも再利用し、host終了時に一度だけ閉じる。
Realtimeのraw transport handlerとタスク状態のsnapshotも再利用するが、会話・承認のapplication event handlerとtool providerは再利用しない。
非同期function toolの結果はprovider leaseへ所属させ、lease終了後に解決した結果を後続activationへ送らない。
この寿命分離により、inactive中に届いた最新のタスク状態も次のactivate時に表示できる。
inactive時の`requestStart()`と`requestStop()`は要求を保留せず例外を投げる。

Dock内部は次の三つの契約に分かれる。

- **wire transport**：CDC上のframe、CRC32、分割EVENTを扱う。
- **media session**：マイク、スピーカー、credit、stream IDの状態を扱う。
- **application event**：音声会話、承認要求、バックグラウンドタスク状態のJSONを扱う。

MODへ公開する境界は`robot.conversation.remoteSession`である。
raw CDC、frame、application eventはMODとmini-appへ公開しない。

`remoteSession.transportState`は、EVENT transportの状態を次の三値で返す。

- `disconnected`：USB SOFを検出していない。
- `unsupported`：USBは接続されているが、HELLO前またはpeerがEVENTを広告していない。
- `ready`：双方がEVENT bit 10を広告し、application eventを送受信できる。

`remoteSession.subscribeTransport()`は、この三値が変化した場合に通知する。
`activationState='inactive'`の間、`transportState`は`disconnected`である。
EVENT非対応時の会話要求はrequest IDを返したうえで即座に`blocked`となり、EVENT frameもretry timerも作らない。
USB未接続時の会話要求は同じrequest IDを最大10秒間保持し、`ready`へ遷移した時点で送信する。

## 動作

FirmwareはCore 1の高優先度WorkerでUSB Serial/JTAGのreadable callbackを処理し、HELLO後に音声制御を受け付ける。
USBSerialはnative RX ringに32 KiB、TX ringに16 KiBの内部RAMを必要とする。
この連続領域をWi-Fi、UI、runtime contextの構築後に要求するとドライバのinstallに失敗するため、Dockは物理USBブリッジをhost起動時に確保する。
低層の`USBSerial`はECMA-419 IO Class Patternに沿い、`read`、`write`、`format`、`onReadable`、`onWritable`、`onError`、`close`を提供する。
USB接続はESP-IDFの`usb_serial_jtag_is_connected()`が検出するSOFで判定する。
単発のSOF欠落ではHELLOとstatusを破棄せず、100 ms連続して未接続を観測した時点で切断を確定する。
SOF判定、speaker処理、credit、diagnosticsには2 msの保守timerを残すが、USB RXとTXの再試行には使わない。
native USB受信ringは32 KiBとし、1回16 KiBのreadを1回のreadable callbackで最大4回実行する。
TXは既存の16 KiB native ringへ最大8 KiBを全量書き込みし、空き不足時はframeを`StreamTxQueue`に保持したまま引数なしの`onWritable()`で再試行する。
最大wire frameは4,120 bytesであるため、空になったnative ringへ必ず1回で書き込める。
追加のstaging bufferは設けず、native TX ringと最大16 KiBの既存frame queueを利用する。
フレームのCRC32はUSB I/Oとは独立したnative moduleで計算し、JavaScript VMがPCM転送を律速しないようにする。
マイクは16 kHz、16 bit little-endian、mono、20 ms frameで送信する。
AudioInの通知値は最大2 KiBの偶数長へ制限し、native側で確保したbufferへ直ちに読み出す。
通知後にringの可読量が変化した場合は、PCM16境界を保ったまま要求長を半減して再試行する。
スピーカーは8 kHz、16 kHz、24 kHzを受け付け、指定されたsample rateをそのまま`AudioOut`へ渡す。
Workerは1秒分のスピーカーqueueへPCMを受け、500 msをprebufferしてから再生を始める。
Workerとmain VMの間はWebRadioと同じ`SharedByteRing`を使い、64 KiBの共有ringへPCMを渡す。
実機の`AudioOut`はmain VMが所有し、`onWritable` callbackと10 msの補助pumpで共有ringを排出する。
`AudioOut`が通知した書き込み可能bytes数はPCMが未到着でも保持する。
この責務分割により、画面描画中もUSB受信を継続し、Worker messageごとのPCMコピーを避ける。

Androidはcredit待ちとは独立した最大5秒の送信queueを持つ。
PCMは80 ms単位で送信し、24 kHz時のpayloadを3,840 bytesにする。
Piperの文単位合成とUSB送信を分離するため、次の文の合成を再生終了まで待たない。

Firmwareがcaption capabilityを返した場合、Androidは読み上げる文をUTF-8の`SPEAKER_TEXT`として対応するPCMの直前に送る。
Firmwareは実際にそのPCMを`AudioOut`へ渡す時点で、最大2行の吹き出しを表示する。
再生中はまばたき、呼吸、視線移動を停止し、PCMのRMSを0.1刻み、125 ms間隔で口の開きへ反映する。
再生終了または中断時は吹き出しと口の開きを消去し、自律表情を再開する。
Androidから認識中状態を受けた場合は回転インジケーターを表示し、発話中はスピーカーアイコンを表示する。
Codexのバックグラウンドタスクが実行中の場合は、会話状態とは独立した青色の回転インジケーターを併記する。
USB EVENT transportが切断された場合は、残留表示を防ぐためタスク状態をidleへ戻す。
画面表示を無効にした診断manifestでもstatus handlerは維持し、会話状態を`remoteSession`へ転送する。

## wire protocol version 2

wire protocolはlittle-endianである。
headerの後ろにpayloadとCRC32を配置する。

| Offset | Size | Field | 値 |
| ---: | ---: | --- | --- |
| 0 | 2 | magic | `0x5343` |
| 2 | 1 | version | `2` |
| 3 | 1 | frame type | `CONTROL=0`、`MICROPHONE_PCM=1`、`SPEAKER_PCM=2`、`EXPRESSION=3`、`MOTION=4`、`DIAGNOSTICS=5`、`EVENT=6` |
| 4 | 2 | flags | control値またはEVENT flag |
| 6 | 2 | stream ID | `0`または1から`65535` |
| 8 | 4 | sequence | frame種別ごとの連番 |
| 12 | 4 | sample rate | Hz |
| 16 | 4 | payload length | 最大`4096` bytes |
| 20 | 可変 | payload | frame payload |
| 20 + payload length | 4 | CRC32 | headerとpayloadを対象とするIEEE CRC32 |

`HELLO`、`HELLO_ACK`、`STATUS`は`streamId=0`を使う。
マイク、スピーカー、EVENTは0以外のIDを使う。
Firmwareは現在のIDと異なる遅延frameを破棄し、別sessionの停止、完了、credit消費に使わない。

EVENTはbit 0の`START`とbit 1の`END`で最大64 KiBのUTF-8 JSONを分割する。
先頭frameのsequenceは0とし、同じstream IDの後続frameで1ずつ増やす。
欠落または順序違いを検出した場合は、そのEVENTだけを破棄する。

version 1との後方互換性は提供しない。
AndroidとFirmwareのwire versionが一致しない接続はhandshakeで拒否する。

## media session

control frameの固定条件は次のとおりである。
`HELLO`のsample rateはversion 2の互換動作として検証しない。

| Control | 値 | 向き | stream ID | sample rate | payload |
| --- | ---: | --- | --- | --- | --- |
| `HELLO` | 1 | AndroidからDock | 0 | 無視 | 最大payloadとcapabilityを表す8 bytes |
| `HELLO_ACK` | 2 | DockからAndroid | 0 | 0 | 合意した最大payloadとcapabilityを表す8 bytes |
| `ERROR` | 3 | DockからAndroid | 0または対象stream | 0 | error codeを表す4 bytes |
| `MIC_START` | 16 | AndroidからDock | 0以外 | 16000 | 0 bytes |
| `MIC_STARTED` | 17 | DockからAndroid | 対象stream | 16000 | 0 bytes |
| `MIC_STOP` | 18 | AndroidからDock | 0以外 | 16000 | 0 bytes |
| `MIC_STOPPED` | 19 | DockからAndroid | 対象stream | 16000 | 0 bytes |
| `SPEAKER_START` | 32 | AndroidからDock | 0以外 | 8000、16000、24000 | 0 bytes |
| `SPEAKER_CREDIT` | 33 | DockからAndroid | 対象stream | sessionのrate | 追加送信可能量を表す4 bytes |
| `SPEAKER_END` | 34 | AndroidからDock | 現在のstream | sessionのrate | 0 bytes |
| `SPEAKER_DONE` | 35 | DockからAndroid | 対象stream | sessionのrate | 0 bytes |
| `SPEAKER_ABORT` | 36 | AndroidからDock | 現在のstream | sessionのrate | 0 bytes |
| `SPEAKER_TEXT` | 37 | AndroidからDock | 現在のstream | sessionのrate | 1から1024 bytesのUTF-8 |
| `STATUS` | 48 | AndroidからDock | 0 | 0 | statusを表す1 byte |

Androidへ返す`SPEAKER_CREDIT`は、追加送信できるbytes数を表す増分値である。
一度に未消費にできるcreditは8 KiBとする。
payloadが未消費creditと等しい場合は受理し、1 byteでも超えた場合は拒否する。

同じマイク開始または停止を再送した場合、Firmwareは同じACKを返す。
古いstream IDのマイク停止、スピーカー終了、スピーカー中断は応答せず破棄する。
同じスピーカー終了は冪等に処理し、追加の`SPEAKER_DONE`を送らない。
HELLOを受信した場合は両session、EVENT decoder、creditを初期状態へ戻す。
USBを切断した場合は、それらに加えてpeer capability、frame parser、送信queueも初期状態へ戻す。

error codeは`INVALID_REQUEST=1`、`INVALID_STREAM_DATA=2`、`TRANSPORT_OVERFLOW=3`、`AUDIO_OUTPUT=4`、`BUSY=5`、`SPEAKER_SEQUENCE_MISMATCH=6`、`SPEAKER_BUFFER_OVERFLOW=7`、`CAPTION_QUEUE_OVERFLOW=8`である。

capability bitは、マイクPCMが0、スピーカーPCMが1、creditが2、8 kHzが3、16 kHzが4、24 kHzが5、字幕が6、診断が7、status iconが8、stream IDが9、EVENTが10、拡張statusが11である。
wire version 2ではstream ID capabilityが必須である。
EVENTは双方がbit 10を広告した場合だけ利用できる。

STATUSは`IDLE=0`、`RECOGNIZING=1`、`SPEAKING=2`、`LISTENING=3`、`CONNECTING=4`、`ERROR=5`である。
受信側Firmwareが拡張status capabilityを広告しない場合は0から2だけを受理する。

## application event schema version 1

application eventは`schema: "stackchan.event.v1"`を持つJSON objectである。
このschema versionはwire protocol version 2から独立して更新する。

| type | 向き | 固有field |
| --- | --- | --- |
| `conversation.start` | DockからAndroid | `requestId`、`source: "headTouch"`、`gesture: "forwardSwipe"` |
| `conversation.stop` | DockからAndroid | `requestId`、`source: "headTouch"`、`gesture: "backwardSwipe"` |
| `conversation.result` | AndroidからDock | `requestId`、`success`、`state`、任意の`error` |
| `approval.request` | AndroidからDock | `requestId`、`kind`、`title`、`summary`、`detail`、`truncated` |
| `approval.resolved` | AndroidからDock | `requestId`、任意の`message` |
| `approval.suspended` | AndroidからDock | `requestId` |
| `approval.presented` | DockからAndroid | `requestId` |
| `approval.response` | DockからAndroid | `requestId`、`decision` |
| `task.status` | AndroidからDock | `requestId`、`state`（`running`または`idle`） |

`conversation.result.state`は`standby`、`connecting`、`listening`、`recognizing`、`speaking`、`blocked`のいずれかである。
`approval.request.kind`は`command`または`fileChange`である。
`approval.response.decision`は`approve`または`decline`である。
`task.status`は音声ターンと独立したCodex threadの実行状態を表し、受信側は最新値をsnapshotとして保持する。
schemaが一致していてもtypeまたはfieldが不正なmessageは破棄し、Realtime API eventとして処理しない。

## 契約テストベクター

wire、media session、application eventの契約は次のJSONで固定する。

- `vendor/stack-chan-dock/contracts/usb-cdc-v2/test-vectors.json`
- `vendor/stack-chan-dock/contracts/usb-cdc-v2/negotiation-vectors.json`
- `vendor/stack-chan-dock/contracts/usb-cdc-v2/application-event-vectors.json`
- `host/modules/usb-audio/contracts/parser-scenarios-v2.json`
- `host/modules/usb-audio/contracts/media-session-v2.json`
- `host/app/remote-session/application-event-v1.json`

Dockの3つのfixtureがwire bytes、能力交渉、application eventの共有正本である。
Firmware固有のparser scenarioは正本と分離する。
TypeScript unit testは3つの正本を検証し、Python diagnostics testも同じwire正本を検証する。

正本を同期する場合は、追跡済みのDock checkoutを指定する。

```bash
npm run vendor:stackchan-dock -- --source /path/to/stack-chan-dock
```

同期元のcommitと各ファイルのSHA-256は`vendor/stack-chan-dock/VENDOR_SOURCE.json`へ記録される。

## 検証

```bash
npm run lint
npm run format
npm run test:unit
npm run check:architecture
npm run check:manifest
npm run test:moddable
python -m unittest scripts/test_usb_audio_diagnostics.py
npm run build:m5stackchan_cores3 -- --mode=release
npm run build:android-usb-audio
```

最後のコマンドはCoreS3向けESP32-S3 imageをリンクし、partition sizeも検査する。

実機で音を出さずに再生経路を計測する場合は、音量0の診断manifestを使う。

```bash
npm run build:android-usb-audio-diagnostics
npm run flash:android-usb-audio-diagnostics
python scripts/usb-audio-diagnostics.py \
  --port /dev/ttyACM0 \
  --duration 15 \
  --caption 'USB音声再生テストです'
```

診断ツールは送受信bytes数、`AudioOut`書き込みbytes数、starvation回数、callback間隔をCSVへ記録する。
同時に、PC側のUSB writeとreadについて、byte数とmicrosecond単位の相対時刻を`.wire.jsonl`へ記録する。
wire logにはPCM本体と字幕本文を保存しない。

Androidが保存した再生traceを使う場合は、次のように実行する。

```bash
python scripts/usb-audio-diagnostics.py \
  --port /dev/ttyACM0 \
  --replay-trace /path/to/playback-trace.jsonl \
  --timing-scale 1 \
  --wire-log dist/usb-audio-diagnostics/android-replay.wire.jsonl
```

replayerはschema version 2の`usb_write` eventからframeを再構築し、`startedElapsedUs`の間隔とwrite単位を維持する。
PCM payloadには無音を使い、字幕payloadには同じbyte数のASCII文字列を使う。
`--timing-scale 0`を指定すると、記録されたwriteを待ち時間なしで連続送信できる。

受信処理の余裕を確認する試験では、最大16個の字幕frameをPCMの直前へ追加できる。

```bash
python scripts/usb-audio-diagnostics.py \
  --port /dev/ttyACM0 \
  --duration 10 \
  --mode credit-driven \
  --initial-caption-count 16 \
  --initial-caption-bytes 1024 \
  --combined-initial-pcm-frames 2
```

`--combined-initial-pcm-frames 2`は、字幕16 frameと先頭PCM 2 frameを一回のホストwriteへまとめる。
wire logの`usb_write`には、write全体のbyte数と時刻に加え、`frames`へ各frameのoffsetとbyte数を記録する。
この試験はAndroid実測traceの再現ではなく、USB受信余裕を確認する合成負荷試験である。
