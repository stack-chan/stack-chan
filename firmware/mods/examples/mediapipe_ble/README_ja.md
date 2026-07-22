# MediaPipe BLE追従MOD

WebのMediaPipeデモからBLE Local Peerで送られる顔向き、表情、手の位置、指の本数を受信します。

- 顔向きは`setPose`へ反映します。
- 笑顔と真顔は`HAPPY`と`NEUTRAL`へ反映します。
- 手は0本、1本、2本、3本以上を、それぞれ握り拳、指差し、ピース、開いた手として表示します。

CoreS3へ直接書き込む場合は`firmware/`から次を実行します。

```sh
npm run mod:m5stackchan_cores3 -- mods/examples/mediapipe_ble/manifest.json
```
