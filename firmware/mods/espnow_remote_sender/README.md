# ESP-NOW remote sender

This MOD broadcasts the current StackChan yaw/pitch over ESP-NOW using the same 8-byte packet accepted by `espnow_remote_receiver`.

## Build and install

Build and deploy a host firmware that includes the ESP-NOW utility first.
Then install this MOD:

```console
npm run mod --target=esp32:./platforms/m5stackchan_cores3 ./mods/espnow_remote_sender/manifest.json
```

## Behavior

The MOD adds an `ESPSend` toggle button to the drawer.
When enabled, it periodically reads `robot.driver.getRotation()`, converts yaw/pitch to 0.1-degree units, and broadcasts:

| Offset | Type | Description |
| --- | --- | --- |
| 0 | `uint8` | target id; default `0` broadcast |
| 1 | `int16le` | yaw angle in 0.1-degree units |
| 3 | `int16le` | pitch angle in 0.1-degree units |
| 5 | `int16le` | speed; default `600` |
| 7 | `uint8` | laser/button flag; default `0` |

Edit `ESP_NOW_REMOTE_SENDER_OPTIONS` in `mod.js` to change the channel, target id, interval, speed, button flag, and startup enabled state.
