# Local Peer Hello

インターネットやアクセスポイントを使わず、近くのｽﾀｯｸﾁｬﾝ同士でテキストを送受信するサンプルです。
ボタン操作は不要で、インストールしたMODの設定に応じて送信機または受信機として自動起動します。

- **送信機**：受信機を発見し、3秒ごとに `hello world 1`、`hello world 2`……を確認付きで送信します。
- **受信機**：受け取ったテキストを吹き出しに表示します。
- 表示前に64 Unicodeコードポイントへ切り詰め、制御文字と双方向表示制御文字を空白へ置換します。
- `payload.text`が文字列でない場合と、空白だけの場合は表示しません。

2台をオフラインで使う場合は、両方のWi-Fi設定画面で「オフライン」を選択してください。
通常Wi-Fiに接続したまま使う場合は、両方を同じアクセスポイントへ接続してください。

## 受信機を起動する

受信機へは標準のマニフェストをインストールします。

```sh
npm run mod:m5stackchan_cores3 -- mods/examples/local_peer_hello/manifest.json
```

## 送信機を起動する

送信機へは送信機用マニフェストをインストールします。

```sh
npm run mod:m5stackchan_cores3 -- mods/examples/local_peer_hello/manifest.sender.json
```

## 送信間隔を変更する

送信間隔を変更する場合は、送信機用マニフェストの `config.localPeerHello.sendIntervalMs` を500ミリ秒以上の値に変更します。
