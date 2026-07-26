# Android USB Audio Dock

**Stackchan Dock**は、外部機器を接続してｽﾀｯｸﾁｬﾝの能力を追加する任意拡張である。
Android USB Audio DockはAndroid端末をUSB側の制御主体とし、M5Stack CoreS3のマイクとスピーカーを音声対話に使用する。
USB Serial/JTAGのCDC経路を使うため、音声通信中はxsbugを同じポートへ接続しない。

## ビルドと書き込み

Moddable SDKとESP-IDFの環境を読み込む。

```bash
source "$HOME/.local/share/xs-dev-export.sh"
npm ci
npm run build:android-usb-audio
npm run flash:android-usb-audio
```

専用manifestは`host/app/manifest_android_usb_audio.json`である。
このmanifestはCoreS3構成を読み込み、`config.usbAudio.enabled`を有効にする。
通常再生時の`AudioOut.volume`は`0.25`に固定する。
通常manifestではUSB音声ブリッジを起動しない。
`flash:android-usb-audio`は書き込み後にserial monitorを起動せず、CDCポートをAndroid向けに解放する。
ビルドコマンドは、通常版と診断版のmanifestを切り替えた場合に同じtargetの生成物を自動消去してから再構築する。
これにより、直前に使ったmanifestの音量や診断capabilityが残らない。

生成物はリポジトリ内の`dist/bin/esp32/m5stackchan_cores3/release/stack-chan-host`へ出力される。

## Dockの構成

共通の`main.ts`は`stackchan-dock`が登録されている場合だけDockを開始する。
Android USB Audio用manifestは、このモジュール名をUSB Dock実装へ割り当てる。
通常版とWASM版はUSB transport、remote session、承認画面をbundleしない。

Dock内部は次の三つの契約に分かれる。

- **wire transport**：CDC上のframe、CRC32、分割EVENTを扱う。
- **media session**：マイク、スピーカー、credit、stream IDの状態を扱う。
- **application event**：音声会話と承認要求のJSONを扱う。

MODへ公開する境界は`robot.conversation.remoteSession`である。
raw CDC、frame、application eventはMODとmini-appへ公開しない。

`remoteSession.transportState`は、EVENT transportの状態を次の三値で返す。

- `disconnected`：USB SOFを検出していない。
- `unsupported`：USBは接続されているが、HELLO前またはpeerがEVENTを広告していない。
- `ready`：双方がEVENT bit 10を広告し、application eventを送受信できる。

`remoteSession.subscribeTransport()`は、この三値が変化した場合に通知する。
EVENT非対応時の会話要求はrequest IDを返したうえで即座に`blocked`となり、EVENT frameもretry timerも作らない。
USB未接続時の会話要求は同じrequest IDを最大10秒間保持し、`ready`へ遷移した時点で送信する。

## 動作

FirmwareはCore 1の高優先度WorkerでUSB受信を2 ms間隔でpollし、HELLO後に音声制御を受け付ける。
USB接続はESP-IDFの`usb_serial_jtag_is_connected()`が検出するSOFで判定する。
この判定を有効にすると、FreeRTOSの各tickへ小さな追加負荷が発生する。
native USB受信ringは32 KiBとし、1回16 KiBのreadを1回のpollで最大4回実行する。
フレームのCRC32はnative実装で計算し、JavaScript VMがPCM転送を律速しないようにする。
マイクは16 kHz、16 bit little-endian、mono、20 ms frameで送信する。
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
拡張status capabilityがないpeerからは0から2だけを受理する。

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

`conversation.result.state`は`standby`、`connecting`、`listening`、`recognizing`、`speaking`、`blocked`のいずれかである。
`approval.request.kind`は`command`または`fileChange`である。
`approval.response.decision`は`approve`または`decline`である。
schemaが一致していてもtypeまたはfieldが不正なmessageは破棄し、Realtime API eventとして処理しない。

## 契約テストベクター

wire、media session、application eventの契約は次のJSONで固定する。

- `vendor/stack-chan-dock/contracts/usb-cdc-v2/test-vectors.json`
- `host/modules/usb-audio/contracts/parser-scenarios-v2.json`
- `host/modules/usb-audio/contracts/media-session-v2.json`
- `host/app/remote-session/application-event-v1.json`

Dockの`test-vectors.json`がbyte単位のwire正本である。
Firmware固有のparser scenarioは正本と分離する。
TypeScript unit testとPython diagnostics testは、vendorした同じwire正本を検証する。

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
python -m unittest scripts/test_usb_audio_diagnostics.py
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
