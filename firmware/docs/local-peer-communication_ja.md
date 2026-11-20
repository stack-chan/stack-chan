# ローカル P2P メッセージ通信

ESP32 系のｽﾀｯｸﾁｬﾝでは、インターネットを経由しない近距離の P2P メッセージ通信を MOD から利用できます。
通信方式の違いはホスト側が吸収するため、MOD は `context.connectivity.localPeer` だけを使用します。

ESP-NOWとBLE Serialを選択できます。
transport未指定時はESP-NOWを優先し、ESP-NOWを組み込まない`esp32/m5stack`ではBLEを使います。

## セッションを開く

```js
const localPeer = context.connectivity.localPeer;
if (!localPeer) throw new Error("この機種ではローカル通信を利用できません");

const session = await localPeer.open({
  service: "com.example.my-mod",
  displayName: "living-room",
  transport: "espnow", // または 'ble'。省略可能
});
```

`service` が異なるセッションは互いのメッセージを受信しません。
同時に開けるセッションは1つです。
セッションは `session.close()` または `context.lifecycle.close()` で解放されます。

## 発見と個別送信

```js
const peers = await session.discover({ timeoutMs: 750 });
if (peers.length > 0) {
  const receipt = await session.send(peers[0].id, "pose.changed", {
    pan: 0.2,
    tilt: -0.1,
  });
  trace(`delivery confirmed after ${receipt.attempts} attempt(s)\n`);
}
```

`send()` は相手のローカル通信層がメッセージを再構成し、確認応答を返した時点で完了します。
相手 MOD の handler が正常終了したことまでは保証しません。
確認応答がない場合は最大3回送信し、それでも届かなければ `LocalPeerError` の `code` が `timeout` になります。

## 受信と一斉送信

```js
const unsubscribe = session.subscribe("pose.changed", (message) => {
  trace(`from=${message.peer.id}, pan=${message.payload.pan}\n`);
});

await session.broadcast("presence", { online: true });

unsubscribe();
```

`subscribe('*', handler)` では全 type を購読できます。
`broadcast()` は確認応答と再送を行いません。

## 制限とセキュリティ

- type と service は1〜64 UTF-8バイト、displayName は最大32バイトです。
- payload は JSON 互換値で、service/type を含むエンコード後の上限は2KiBです。
- 通常 Wi-Fi 接続中は接続先アクセスポイントのチャネルを使用します。オフライン時は既定でチャネル1を使うため、通信する端末を同じ状態にしてください。
- `sharedKey` を指定すると、発見後の個別送信と確認応答を認証します。ESP-NOWでは暗号化も行いますが、BLE SerialのHMACは改ざん検知だけで内容を暗号化しません。16〜64 UTF-8バイトで、通信する端末へ同じ値を設定してください。
- discovery と broadcast は暗号化されません。機密情報は broadcast しないでください。
- peer の `id` は不透明な識別子です。形式を解析したり、別の用途へ流用したりしないでください。

## BLE Serial transport

BLEではｽﾀｯｸﾁｬﾝがNordic UART Service peripheralとして`STK-LP-XXXX`という名前で広告します。
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
BLE serverを直接起動するMODとは同時利用できません。

BLEのunicastにも`sharedKey`を指定できます。
ESP-NOWと同じ共有鍵由来のHMACで送信元、宛先、内容を認証します。
BLE pairingやbondingの有無だけで`peer.secure`が`true`になることはありません。

動作例は [`local_peer_hello`](../mods/examples/local_peer_hello/README_ja.md) を参照してください。
