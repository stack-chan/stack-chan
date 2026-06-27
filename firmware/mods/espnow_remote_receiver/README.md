# ESP-NOW remote receiver

This MOD enables the StackChan body to receive angle commands over ESP-NOW.
It implements only the receiver side; the remote controller firmware is not included.

## Build and install

Build the M5StackChan CoreS3 host first:

```console
mcconfig -d -m -p esp32:./platforms/m5stackchan_cores3 -t build "$PWD/stackchan/manifest_m5stackchan_cores3.json"
```

Install this MOD:

```console
npm run mod --target=esp32:./platforms/m5stackchan_cores3 ./mods/espnow_remote_receiver/manifest.json
```

## Packet format

The receiver accepts the 8-byte packet used by `reference/StackChan`.

| Offset | Type | Description |
| --- | --- | --- |
| 0 | `uint8` | target id; `0` means broadcast |
| 1 | `int16le` | yaw angle in 0.1-degree units, clamped to `-1280..1280` |
| 3 | `int16le` | pitch angle in 0.1-degree units, clamped to `0..900` |
| 5 | `int16le` | speed, clamped to `0..1000` |
| 7 | `uint8` | laser/button flag; mapped to the configured LED |

Edit `ESP_NOW_REMOTE_OPTIONS` in `mod.js` to change the Wi-Fi channel, receiver id, polling interval, LED name, and startup enabled state.
The MOD adds an `ESPNow` toggle button to the drawer; turning it off closes ESP-NOW reception and turns the configured LED off.
