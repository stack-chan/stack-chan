# ｽﾀｯｸﾁｬﾝ ケース v0

[English](./README.md)

![case](./docs/images/case.jpg)
![case_inside](./docs/images/case_inside.jpg)

現在、[ケースデータ](https://a360.co/3gcw960)はFusion360で作成しています。

## ケースは新しい仕様（v1.0）に移行中です

より互換性を高めた新しいケースに移行中です。

- ケース v0（このドキュメント）
  - 基板: [`v0.2.1`](https://github.com/meganetaaan/stack-chan/tree/v0.2.1/schematics)
  - 対応するサーボモータ: RX30X, SCS0009, SG90
- [ケース v1.0](./v1/dynamixel_ja.md)
  - 基板: [`v1.0`](../schematics/)
  - 対応するサーボモータ: XL330（随時追加予定）

__最新仕様のケースは[ｽﾀｯｸﾁｬﾝ ケース v1.0のドキュメント](./v1/dynamixel_ja.md)を参照してください__

## 編集

各ディレクトリのSTEPファイルをCADでインポートすると編集できます。

## 3Dプリント

各ディレクトリのSTLファイルを使って印刷ができます。
印刷の向きは次図のようにすると、仕上がりがきれいです。

![印刷向き](./docs/images/print_orientation.jpg)

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
    * [シリアルサーボ RS30Xシリーズ(TTL通信)](https://www.vstone.co.jp/robotshop/index.php?main_page=product_info&products_id=2685)
    * [シリアルサーボ SCS0009(TTL通信)](https://www.switch-science.com/catalog/8042/) serial servo
    * [PWMサーボ SG-90](https://akizukidenshi.com/catalog/g/gM-08761/)
* PH 2ピンのケーブル付きの3.7Vバッテリー
  * 以下で動作確認しています
    * [400mAhのリチウムポリマーバッテリー](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-4YZL)
    * [640mAhのリチウムポリマーバッテリー](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-5GHY))
* ねじ
  * M2 4mm * 4本
  * M2 8mm * 2本
  * （オプション）M3 15mm * 2本

### シリアルサーボの設定

シリアルサーボは通信線を共有しており、IDを指定して角度変更や取得、トルクのオンオフなどを切り替える仕組みです。
そのためあらかじめ異なるIDを割り当てておく必要があります。

- ID1: 足側（左右回転、パン軸）
- ID2: 顔側（上下回転、チルト軸）

シリアルサーボのドライバには[IDを書き換えるコマンド`flashId`があります](https://github.com/meganetaaan/moddable-scservo/blob/71292b9358353837a74ecea387cd3265a610479f/src/scservo.ts#L274)。
このコマンドを使うとｽﾀｯｸﾁｬﾝ基板のみでサーボのIDを設定できます。

### サーボの角度について

サーボの取り付け角度は次のようにします。

- 可動範囲の中央が基準角度（ｽﾀｯｸﾁｬﾝが正面を向くときの角度）になります。
- 基準角度に十字のサーボホーンの凸が合うように取り付けてください。
- サーボの取り付け向きが間違っている場合、ｽﾀｯｸﾁｬﾝの筐体と干渉して正しく動作しません。
  - サーボをケースに固定する前に、一度ファームウェアを書き込んでの動作確認をおすすめします。
- サーボの種類ごとに可動範囲と基準角度が異なります（次表参照）

|サーボ  |可動範囲   |基準角度 |
|:------|:---------|:------|
|SG-90  |0~180度   |90度    |
|RS30X  |-150~150度|0度     |
|SCS0009|0~200度   |100度   |

### （参考）SCS0009をGUIでセットアップする

次の設定をFeetech公式のGUIツールを使って行います。

* サーボのIDを変更する
* サーボの角度を基準角度に変更する

SCS0009本体に加えて次のものが必要です。

* [URT1](https://www.switch-science.com/catalog/7490/)
* 6-9Vの電源

* GUIのデバッグツールを[gitee（中国版GitHub）のFeetechのリポジトリ](https://gitee.com/ftservo/fddebug)からダウンロードします。
* URT1を接続します
  * 「DC6V-9V」…電源
  * 「USB」…microUSBケーブルを介してPCに接続
  * 「G V1 S」…SCS0009を接続（同じIDのサーボを複数接続すると正しく動作しません）
* `FD.exe`を開きます
* URT1を接続したCOMポートを選択し、その他の値はデフォルトから変更せず「Connect」を選択します
* 「Scan」を選択します
* 左下に接続されたサーボが表示されるので選択します

![接続](./docs/images/connect.jpg)

* 「Goal」の値を511にして「Set」を選択します
  * サーボが基準角度まで回転します
* IDを変更する場合「Programming」タブを開きます。
* 「ID」の行を選択し、値を変更して「Save」を選択します。
  * IDが書き換わります。

![IDの変更](./docs/images/id.jpg)

__注意：ここで「Recovery」を選択するとサーボが正しく動作しなくなりますのでご注意ください__

### 組み立て方

(RS304MDを使った場合です。SG-90, SCS0009も似ています)

#### ブラケット

![ステップ1](./docs/videos/bracket.gif)

* サーボをブラケットに差し込みます。
  * シリアルサーボの場合、足側（左右回転）がID: 1のサーボ、顔側（上下回転）がID: 2のサーボになります。
* バッテリーをバッテリーケースに差し込みます。
* 爪を引っ掛けるようにしてバッテリーケースをブラケットに差し込みます。

#### 外殻と足

![ステップ2](./docs/videos/shell_and_feet.gif)

* ねじで足と外殻を固定します(それぞれM2-8mm * 1本)

#### M5Stackと基板

![ステップ3](./docs/videos/m5stack_and_board.gif)

* サーボとバッテリーのケーブルを基板に接続します。コネクタの向きが正しいか確認してください。
  * シリアルサーボの場合、ID1のサーボが足側（パン軸）、ID2のサーボが顔側（チルト軸）になります。

SCS0009の場合、信号線（白いケーブル）が右側のピンに接続されます。

![SCS0009の接続](./docs/images/scservo_cable_connection.jpg)

* 基板をねじで固定します(M2-4mm * 4本)。
* M5Stackをロボットにスタックします。
* M5Stackを固定する場合、下側の2つの穴を使ってねじで固定します(M3-15mm * 2本)
