# Local peer messaging

ESP32 Stack-chan targets expose nearby messaging through the SDK `network(app)` extension without requiring the Internet. Declare app API 2, host API 7 or later, and `network.peer` in `stackchan-mod.json`. The host supports ESP-NOW and BLE Serial behind the same API.

```js
import { network } from "stackchan/extensions/network";

// Inside defineApp's async setup(app)
const session = await network(app).openPeer({
  service: "com.example.my-mod",
  displayName: "living-room",
  transport: "ble", // 'espnow', or omit to use the platform default
});

const peers = await session.discover();
if (peers.length)
  await session.send(peers[0].id, "pose.changed", { pan: 0.2, tilt: -0.1 });
```

ESP-NOW is preferred when `transport` is omitted. The 4 MB `esp32/m5stack` build contains only BLE and therefore defaults to BLE. An explicitly requested unavailable transport rejects with `StackchanError.code === 'UNSUPPORTED'`.

BLE advertises the Nordic UART Service as `STK`. It accepts one PC or phone central at a time. `discover()` returns that connected central, while `broadcast()` sends to it without acknowledgement. A broadcast made while disconnected is not delivered. Use the reusable [Web Bluetooth client](../../web/local-peer/ble-local-peer.mjs) from a user gesture that is allowed to open the browser device chooser.

The limits remain 64 UTF-8 bytes for service and type, 32 bytes for display name, and 2 KiB for an encoded message. Reliable sends use acknowledgement, bounded retry, reassembly, and duplicate suppression. BLE unicast with `sharedKey` uses the same derived HMAC authentication as ESP-NOW, but the BLE HMAC does not encrypt message contents. Discovery and broadcast remain unauthenticated.

Only one local-peer session and one BLE central are supported. Setup mode closes its BLE preference server before normal boot. Coexistence and conflict handling with other BLE features still require validation. The app owns its session and subscriptions; app shutdown closes them. You can close a session earlier with `await session.close()` or release an `onMessage(type, handler)` subscription with its returned function. A reliable send resolves after acknowledgement by the peer transport, not after completion of the remote app handler.

Pass `{ signal: task.signal }` to `discover`, `send` and `broadcast`. Cancellation clears discovery timers, ACK waits and retries and stops enqueueing remaining fragments. Frames already accepted by the radio cannot be recalled. A cancelled operation reports `CANCELLED`; the session remains reusable. Connection/app shutdown reports `CLOSED` and also closes a radio acquired during an unfinished open.

Firmware uses the SDK `StackchanError`: `BUSY` for a second local-peer open, `INVALID_ARGUMENT` for invalid input, `UNSUPPORTED` for an unavailable transport, `TIMEOUT` for missing acknowledgements and `IO` for device/delivery failures. The former `LocalPeerError` and its lowercase codes are retired.
