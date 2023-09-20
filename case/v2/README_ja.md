# スタックチャン ケース v1.0

## 必要なもの（DYNAMIXEL版）

1. 基板 x1
2. M5 Stack CoreS3 x1
3. horn x1
4. shell x1
5. gear_XL330 x2
6. backpack
7. bracket_XL330_f x1
8. bracket_XL330_b x1
9. M2x4mm なべタッピングネジ x4
10. feet_top x1
11. feet_bottom x1
12. M2.5x6mm バインドタッピングネジ x2(XL330に付属)
13. 4cm 通信ケーブル x2
14. XL330 x2

### XL330のIDと通信レートの変更

XL330のIDと通信レートの変更にはROBOTISのDynamixel Wizard2を使用します。PCとXL330を接続するには以下の機材が必要になります。

#### XL330以外で必要になるもの

- [U2D2](https://www.rt-shop.jp/index.php?main_page=product_info&products_id=3618)
- [SMPS2Dynamixel](https://www.rt-shop.jp/index.php?main_page=product_info&products_id=523)
- 5VのACアダプタ

#### Dynamixel wizard2をインストール

[emanual.robotis](https://emanual.robotis.com/docs/en/software/dynamixel/dynamixel_wizard2/)のsoftware DownloadにあるLinuxをクリックするとダウンロードします。
アクセス権に実行をつけてダブルクリックするとインストールが開始します。

#### IDと通信速度の変更

XL330のデフォルト設定はID=1,bps=57600なのでIDとbpsを変更します。

|  | ID | bps |
|--|----|-----|
| 足のサーボ    | 1  | 1M  |
| 首振りのサーボ | 2  | 1M  |

### IDとbpsを書き換える手順

1. Optionsをクリックし、XL330と接続しているUSBを選択します。
2. ScanをクリックするとXL330と接続し現在の状態を確認できます。
3. IDとRand Rateをクリックし、右下のセレクトボックスから「1000000bps」を選択、Saveボタンを押してパラメータを反映します。

**注意**: 同じIDのサーボを複数つなぐことはできません。IDの書き換え時はサーボを一つずつ接続する必要があります。

## 組み立て手順

### 足のサーボの組み立て

- サーボのボスが写真の上(赤丸)に来るように配置。id=1
- M2.5x6mmのタッピングネジで固定
- feet_bottomをスライドして入れる

### 首振りサーボの組み立て

- サーボのボスが写真の左(赤丸)に来るように配置。id=2
- M2.5x6mmのタッピングネジで固定

### ボディの組み立て

1. ケーブルをつける
2. bracket_XL330_f を使って上下のサーボを組み合わせる
3. bracket_XL330_bを使って上下のサーボを固定する
4. 基板とサーボをケーブルで接続する
5. shellにhornをスライドして入れる
6. 基板とShellを2x4mm なべタッピングネジで4箇所固定する
7. M5Stack本体をはめ込む

## 完成
