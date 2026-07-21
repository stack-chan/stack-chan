# Android USB音声ブリッジ

この構成はAndroid端末をUSBホストとし、M5Stack CoreS3のマイクとスピーカーを音声対話に使用する。
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

生成物はリポジトリ内の`dist/bin/esp32/m5stackchan_cores3/release/stack-chan-host`へ出力される。

## 動作

FirmwareはCore 1の高優先度WorkerでUSB受信を2 ms間隔でpollし、HELLO後に音声制御を受け付ける。
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

Androidへ返す`SPEAKER_CREDIT`は、追加送信できるbytes数を表す増分値である。
一度に未消費にできるcreditは12 KiBとし、native USB受信ringの16 KiBを超えるburstを防ぐ。
不正なsample rate、sequence、payload、queue超過は`ERROR`で通知し、該当する音声処理を停止する。

`SPEAKER_TEXT`はcontrol値37、capability bit 6である。
payloadは最大1,024 bytesのUTF-8とし、既存Firmwareとの互換性を保つため任意機能として扱う。

`STATUS`はcontrol値48、capability bit 8である。
payloadは1 byteで、`IDLE=0`、`RECOGNIZING=1`、`SPEAKING=2`とする。
この通知は再生セッションから独立しているため、Whisperの認識処理中にもアイコンを表示できる。

wire仕様の詳細はAndroidプロジェクトの`docs/SERIAL_NEXT_STEP.md`を参照する。

## 検証

```bash
npm run lint
npm run test:unit
npm run check:manifest
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
