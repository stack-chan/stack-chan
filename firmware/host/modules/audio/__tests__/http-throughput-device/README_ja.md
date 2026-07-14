# HTTPスループット実機テスト

M5StackChan CoreS3のWi-Fi、TCP、HTTP受信速度だけを測定します。
MP3デコード、リサンプル、AudioOutは起動しません。

PCとCoreS3を同じWi-Fiへ接続し、PCでサーバーを起動します。

```console
npm run test:http-throughput-server
```

`throughput.protocol`に`http`または`https`、`throughput.host`にPCのIPv4アドレス、`throughput.path`に受信パス、`testWiFi`に実機用Wi-Fi設定を指定したローカルマニフェストで書き込みます。
実機は30秒間受信し、1秒ごとの速度と平均速度を出力します。

```console
npm run test:http-throughput-device:build
npm run test:http-throughput-device:flash
```
