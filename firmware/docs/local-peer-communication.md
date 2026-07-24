# Local peer messaging

ESP32 Stack-chan targets expose nearby messaging through `context.connectivity.localPeer` without requiring the Internet. The host supports ESP-NOW and BLE Serial behind the same API.

```js
const session = await context.connectivity.localPeer.open({
  service: "com.example.my-mod",
  displayName: "living-room",
  transport: "ble", // 'espnow', or omit to use the platform default
});

const peers = await session.discover();
if (peers.length)
  await session.send(peers[0].id, "pose.changed", { pan: 0.2, tilt: -0.1 });
```

ESP-NOW is preferred when `transport` is omitted. The 4 MB `esp32/m5stack` build contains only BLE and therefore defaults to BLE. An explicitly requested unavailable transport rejects with `LocalPeerError.code === 'not-supported'`.

BLE advertises the Nordic UART Service as `STK-LP-XXXX`. It accepts one PC or phone central at a time. `discover()` returns that connected central, while `broadcast()` sends to it without acknowledgement. A broadcast made while disconnected is not delivered. Use the reusable [Web Bluetooth client](../../web/local-peer/ble-local-peer.mjs) from a user gesture that is allowed to open the browser device chooser.

The limits remain 64 UTF-8 bytes for service and type, 32 bytes for display name, and 2 KiB for an encoded message. Reliable sends use acknowledgement, bounded retry, reassembly, and duplicate suppression. BLE unicast with `sharedKey` uses the same derived HMAC authentication as ESP-NOW, but the BLE HMAC does not encrypt message contents. Discovery and broadcast remain unauthenticated.

Only one local-peer session and one BLE central are supported. Setup mode closes its BLE preference server before normal boot. A MOD that directly starts another BLE server cannot run alongside the BLE local-peer transport.
