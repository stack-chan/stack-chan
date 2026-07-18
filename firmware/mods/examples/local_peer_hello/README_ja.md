# Local Peer Hello

インターネットやアクセスポイントを使わず、近くのｽﾀｯｸﾁｬﾝ同士でメッセージを送受信するサンプルです。

- A ボタン: 近くの端末を発見し、最初の1台へ確認付き `hello` を送信
- B ボタン: 同じ service の端末全体へ `wave` を一斉送信
- `hello` を受信: `hello.reply` を送信元へ返信

2台をオフラインで使う場合は、両方の Wi-Fi 設定画面で「オフライン」を選択してください。
通常 Wi-Fi に接続したまま使う場合は、両方を同じアクセスポイントへ接続してください。

```sh
npm run mod:m5stackchan_cores3 -- mods/examples/local_peer_hello/manifest.json
```

暗号化する場合は `mod.js` の `sharedKey` を有効にし、通信する端末へ同じ16〜64 UTF-8バイトの値を設定します。
