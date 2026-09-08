# ローカル P2P メッセージ通信

ESP32 系のｽﾀｯｸﾁｬﾝでは、インターネットを経由しない近距離の P2P メッセージ通信を MOD から利用できます。
アプリはSDKの `network(app)` 拡張を使います。`stackchan-mod.json` にapp API 2、host API 7以降、`network.peer` を宣言してください。

ESP-NOWとBLE Serialを選択できます。
transport未指定時はESP-NOWを優先し、ESP-NOWを組み込まない`esp32/m5stack`ではBLEを使います。

## セッションを開く

```js
import { network } from "stackchan/extensions/network";

// defineApp の async setup(app) 内
const session = await network(app).openPeer({
  service: "com.example.my-mod",
  displayName: "living-room",
  transport: "espnow", // または 'ble'。省略可能
});
```

`service` が異なるセッションは互いのメッセージを受信しません。
同時に開けるセッションは1つです。
セッションは `session.close()` または アプリの終了 で解放されます。

## 発見と個別送信

```js
const peers = await session.discover({ timeoutMs: 750 });
if (peers.length > 0) {
  await session.send(peers[0].id, "pose.changed", {
    pan: 0.2,
    tilt: -0.1,
  });
  trace("delivery confirmed\n");
}
```

`send()` は相手のローカル通信層がメッセージを再構成し、確認応答を返した時点で完了します。
相手 MOD の handler が正常終了したことまでは保証しません。
確認応答がない場合は最大3回送信し、それでも届かなければ `StackchanError` の `code` が `TIMEOUT` になります。

## 受信と一斉送信

```js
const unsubscribe = session.onMessage("pose.changed", (message) => {
  trace(`from=${message.peer.id}, pan=${message.payload.pan}\n`);
});

await session.broadcast("presence", { online: true });

unsubscribe();
```

`onMessage('*', handler)` では全 type を購読できます。
`broadcast()` は確認応答と再送を行いません。

`discover` / `send` / `broadcast` に `{ signal: task.signal }` を渡せます。取消しは探索timer、確認応答待ち、再試行と未送信fragmentに届きます。すでにradioが受け付けたframeは取り消せません。取消した操作だけが `CANCELLED` となり、同じ接続で再度送信できます。接続・アプリ終了は `CLOSED` です。接続開始中のアプリ終了も、取得済みradioを解放します。

同じlocal-peerサービスの二重openは `BUSY`、値の不正は `INVALID_ARGUMENT`、未対応transportは `UNSUPPORTED`、確認応答timeoutは `TIMEOUT`、機器・配送の失敗は `IO` です。旧 `LocalPeerError` 型と小文字のcodeは撤去し、SDKの `StackchanError` を使います。

## 制限とセキュリティ

- type と service は1〜64 UTF-8バイト、displayName は最大32バイトです。
- payload は JSON 互換値で、service/type を含むエンコード後の上限は2KiBです。
- 通常 Wi-Fi 接続中は接続先アクセスポイントのチャネルを使用します。オフライン時は既定でチャネル1を使うため、通信する端末を同じ状態にしてください。
- `sharedKey` を指定すると、発見後の個別送信と確認応答を認証します。ESP-NOWでは暗号化も行いますが、BLE SerialのHMACは改ざん検知だけで内容を暗号化しません。16〜64 UTF-8バイトで、通信する端末へ同じ値を設定してください。
- discovery と broadcast は暗号化されません。機密情報は broadcast しないでください。
- peer の `id` は不透明な識別子です。形式を解析したり、別の用途へ流用したりしないでください。

## BLE Serial transport

BLEではｽﾀｯｸﾁｬﾝがNordic UART Service peripheralとして`STK`という名前で広告します。
Web Bluetooth対応のPCまたはスマートフォンから接続してください。
再利用可能なクライアントは[`web/local-peer/ble-local-peer.mjs`](../../web/local-peer/ble-local-peer.mjs)にあります。

```js
import BLELocalPeerCapability from "./ble-local-peer.mjs";

const localPeer = new BLELocalPeerCapability();
const session = await localPeer.open({
  transport: "ble",
  service: "com.example.my-mod",
  displayName: "browser",
});
const [stackchan] = await session.discover();
await session.send(stackchan.id, "pose.changed", { pan: 0.2, tilt: -0.1 });
```

BLE transportは同時に1台のcentralだけをpeerとして扱います。
`discover()`は接続中のcentralを返し、`broadcast()`はそのcentralへ確認応答なしで送ります。
BLE未接続時の`broadcast()`は配送されません。
セットアップ画面と通常起動後のlocalPeerは同じNordic UART Serviceを別の起動フェーズで利用します。
未対応のtransport指定は `UNSUPPORTED` になります。他のBLE機能との同時利用・競合処理の検証は継続中です。セッションと購読はアプリが所有し、終了時に解放します。

BLEのunicastにも`sharedKey`を指定できます。
ESP-NOWと同じ共有鍵由来のHMACで送信元、宛先、内容を認証します。
BLE pairingやbondingの有無だけで`peer.secure`が`true`になることはありません。

動作例は [`local_peer_hello`](../mods/examples/local_peer_hello/README_ja.md) を参照してください。
