# ｽﾀｯｸﾁｬﾝ ケース

[Enblish](./README.md)

![case](./docs/images/case.jpg)
![case_inside](./docs/images/case_inside.jpg)

現在、[ケースデータ](https://a360.co/3gcw960)はFusion360で作成しています。

## 組み立て

### パーツ

* 3Dプリントしたケース
  * 外殻(Shell)
  * 足(Feet)
  * ブラケット(Bracket)
  * バッテリーケース(Battery backpack)
* M5Stack Core (Basic/Gray/Go/Fireのいずれか), またはCore2
* [Stack-chan 基板](../schematics/README.md)
* サーボモータ2つ
  * 現在次のモータで動作確認しています
    * シリアルサーボ RS30Xシリーズ(TTL通信)
    * PWMサーボ SG-90
* PH 2ピンのケーブル付きの3.7Vバッテリー
  * 以下で動作確認しています
    * [400mAhのリチウムポリマーバッテリー](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-4YZL)
    * [640mAhのリチウムポリマーバッテリー](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-5GHY))
* ねじ
  * M2 4mm * 4本
  * M2 8mm * 2本

### 組み立て方

(RS304MDを使った場合です。SG-90も似ています)

#### ブラケット

![ステップ1](./docs/videos/bracket.gif)

* サーボをブラケットに差し込みます。
* バッテリーをバッテリーケースに差し込みます。
* 爪を引っ掛けるようにしてバッテリーケースをブラケットに差し込みます。

#### 外殻と足

![ステップ2](./docs/videos/shell_and_feet.gif)

* ねじで足と外殻を固定します(それぞれM2-8mm * 1本)

#### M5Stackと基板

![ステップ3](./docs/videos/m5stack_and_board.gif)

* サーボとバッテリーのケーブルを基板に接続します。コネクタの向きが正しいか確認してください。
* 基板をねじで固定します(M2-4mm * 4本)。
* M5Stackをロボットにスタックします。
