# Web Radio 実機テスト

M5StackChan CoreS3 の Web Radio 音声経路だけを検証するアプリです。
UI、顔、MOD、サーボは起動しません。

通常の stack-chan host が保存した `wifi/ssid` と `wifi/password` を使用し、HTTP の MP3 ストリームを再生します。
HTTP受信はメインXSから512KBの共有リングへ退避し、MP3デコードはCore 1 Workerで実行します。
ログには再生済みバッファ数を出力します。
CPUとメモリはxsdbの `info instruments` で確認します。

```console
npm run test:web-radio-device:build
npm run test:web-radio-device:flash
```

テスト後は通常のhostとMODを書き戻してください。
