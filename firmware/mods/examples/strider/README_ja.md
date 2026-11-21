# Strider MOD

M5StackChan K151に[Striderの足回り](https://github.com/Yeq6X/stackchan-strider/tree/v1.1.0)を取り付けると、首の回転で歩行と旋回ができます。標準Hostの連続回転APIに対応したファームウェアが必要です。

## 導入と操作

1. `firmware/`から、同じチェックアウトの標準HostとStrider MODを書き込みます。`PORT`をK151のUSBシリアルポート名に置き換えてください。

    ```sh
    npm run flash:m5stackchan_cores3 -- --mode=release --port=PORT
    npm run mod:m5stackchan_cores3 -- mods/examples/strider/manifest.json --mode=release --port=PORT
    ```

2. 本体がWi-Fiの設定を求めたら、オフライン起動を選びます。
3. Web Bluetooth対応のChromeで、書き込んだビルドと同じ配布先のStrider操作ページを開きます。[開発版](https://stack-chan.github.io/stack-chan/develop/web/strider/) · [リリース版](https://stack-chan.github.io/stack-chan/web/strider/)
4. 接続を押し、Bluetoothの一覧からK151の `STK` を選びます。方向ボタンを押している間だけ動きます。離すか、停止を押すと止まります。歩行速度の設定は前進と後退に適用します。

初回や足回りの組み付けを変えた後は、平らで十分な広さのある場所で旋回を調整します。**押して調整**を押したままにすると、約8秒前進してから約8秒後退し、旋回の設定を本体に保存します。途中で手を離すと停止します。調整が済むと左右旋回を選べます。

操作ページは静的HTTPS配信に対応します。操作指令はBLE Serialで送り、本体へのWi-Fi接続は不要です。BLE切断時と指令の更新が400 ms途絶えたときは、MODが停止処理を開始します。MODからの停止が届かない場合に備え、Host側の回転指令にも最後のBLE指令から最大550 msの有効期限があります。再開には新しいボタン操作が必要です。

## MODの配布

`firmware/`で `npm run mod:build -- mods/examples/strider/manifest.json --mode=release` を実行すると、`dist/bin/esp32/release/strider/strider.xsa` が生成されます。配布時は `LICENSE-MIT` を同梱してください。Host側の条件は[連続回転APIの契約](../../../docs/api_ja.md#首の連続回転)を参照してください。

## 出典

旋回の位置推定とジャイロによる調整は、Yeq6Xの[Stackchan Strider v1.1.0の `firmware/src/main.cpp`](https://github.com/Yeq6X/stackchan-strider/blob/c3116d3d40cdab4b42cc4666efba65e46b2d21b7/firmware/src/main.cpp)をJavaScriptに移植しています。移植元の条件は [MITライセンス](./LICENSE-MIT) を参照してください。
