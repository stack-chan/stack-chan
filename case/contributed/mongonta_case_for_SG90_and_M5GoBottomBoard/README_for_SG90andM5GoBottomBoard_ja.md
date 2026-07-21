# Stack-chan case for SG90 and M5GoBottom
日本語 | [English](./README_for_SG90andM5GoBottomBoard.md)

# 注意事項
M5Stackの基板はｽﾀｯｸﾁｬﾝ基板とは寸法が異なるので、ｽﾀｯｸﾁｬﾝ基板はこちらのモデルには使用できません。

# 外観

<img src="./docs/images/case_sg90_m5core2.jpg" width="320">
<img src="./docs/images/case_sg90_m5stackbasic.jpg" width="320">

[case data](./case_for_SG90andM5GoBottomBoard/)はFusion360で作成され、DesignSparkMechanicalで修正しました。

# 最新情報
こちらのREADMEは簡略化しているので情報が古い場合があります。最新の情報は下記のページを確認してください。

* [ｽﾀｯｸﾁｬﾝ タカオ版組み立てキットの頒布について](https://raspberrypi.mongonta.com/about-products-stackchan-m5gobottom-version/)
* 組み立て方法
  * 分解なし
    * [ｽﾀｯｸﾁｬﾝ タカオ版 組み立て方法【その１ 部品キット編】](https://raspberrypi.mongonta.com/how-to-make-stackchan-m5gobottom/)
    * [分解作業なしでｽﾀｯｸﾁｬﾝを作る。【ｽﾀｯｸﾁｬﾝ タカオ版 組み立てキット】](https://raspberrypi.mongonta.com/how-to-build-easy-stackchan-m5gobottom/)
  * 分解あり
    * [ｽﾀｯｸﾁｬﾝ タカオ版 組み立て方法【その１ 部品キット編】](https://raspberrypi.mongonta.com/how-to-make-stackchan-m5gobottom/)
    * [ｽﾀｯｸﾁｬﾝ M5GoBottom版 組み立て方法【分解あり】【その2 ケースセットの組み立てと完成まで】](https://raspberrypi.mongonta.com/how-to-make-stackchan-m5gobottom-2/)

# ファイル一覧

* 3Dプリンタの出力品
  * シェル(3種類あります。)
    1. shell_SG90_gobottom_v1.0.stl<br>Core2(白)。Core2forAWS（黄色）、用
    1. shell_SG90_basicgraybottom_v1.0.stl<br>BasicとGrayのボトムを分解して固定する用
    1. shell_SG90_Goplus2_module_v1.0.stl<br>Core2+GoPlus2モジュールを使う用
  * 足
    1. feet_SG90_v1.0.stl
  * ブラケット(3種類あります。)
    1. bracket_SG90_v2.0.stl<br>スイッチサイエンスで購入できる[Stack-chan_Takao_Base](https://www.switch-science.com/products/8905)に対応したバージョンです。
    1. bracket_SG90_v1.1.stl<br>TowerPro SG90のサイズに対応したものです。
    1. bracket_MG90S_V1.0.stl<br>TowerPro MG90S（純正品）の寸法に対応したものです。
  * スペーサー<br>分解なしの手順のみ使用します。
    1. spaver_v1.0.stl

  * HAT<br>頭の上にかぶせて使用するアクセサリーです。
    1. hat_base_v1.0.stl<br>何もついていないHAT
    1. hat_cat_ear_v2.0.stl<br>猫耳HAT
    1. hat_hippo_ear_v1.0.stl<br>小さいカバの耳HAT
    1. hat_lego_9hole_v1.0.stl<br>UnitLCDやUnitOLEDを取り付けられます。
    1. hat_lego_back_v1.0.stl<br>後ろ側にlegoホールが3つ付いたHAT
    1. hat_lego_front_v1.0.stl<br>前側にlegoホールが3つ付いたHAT
    1. hat_stick_adapter_v1.0.stl<br>M5StickCやCPlus、M5StickVを固定できるHAT



## 用意するもの（最新情報は前述のブログで確認してください。）
* M5Stack Core Basic/Gray/Go/Fire(+M5GoBottom1) M5Stack Core2(+ M5GoBottom2)
  * 推奨は[M5Stack Core2](https://shop.m5stack.com/collections/m5-controllers/products/m5stack-core2-esp32-iot-development-kit)です。
  * M5Stack Basic/Gray/Go/Fireと組み合わせる場合は[Power Switch for M5Stack](https://www.switch-science.com/catalog/5726/)及び[ケース](https://www.switch-science.com/catalog/6295/)の装着をおススメします。電源が切れないのでバッテリーの劣化を早めてしまいます。

* サーボ 2個
  * 対応しているサーボは下記のとおりです。
    * SG-90 pwm servo<br>ケーブルの長さが短い[M5Stack Servo Kit 180°](https://shop.m5stack.com/collections/m5-accessories/products/servo-kit-180)がおススメです。

* ネジやボルト
  * M1.4～M1.6 5mm * 8個 
  * SG90付属 2mmネジ 4個 1.6mm?ネジ 2個
  * M5GoBottom固定用ボルト(M5Stack Core2 for AWSIoT EduKitに付属)
    * M3 18mm * 2個
    * M3 15mm * 2個(for M5Stack Core2 only)
* ケーブル
  * [GROVE - サーボ用2分岐ケーブル (5本セット)](https://www.switch-science.com/catalog/1250/)
  * ケーブルタイ

### 工具
  * 精密ドライバセット（プラスドライバ）
  * 六角レンチ（1.5mmと2.5mm）
  * ニッパー

# MG90Sについて
 MG90Sについては純正品に合わせたブラケットを公開してあります。しかし下記の問題があるため注意してください。

1. 電源が足りない。<br>MG90SはM5Stackの内部バッテリーだけでは動かない場合があります。その際は、サーボ用の電源を別で確保する必要があります。
1. AmazonやAliExpressでの模倣品の中にサイズが違うものがあります。<br>MG90Sとして売っていますが、寸法がSG90と同じものやサーボホーンの大きさが違うものがあります。特にサーボホーンが違うとSG90版とも合わないのでその場合はホーン部分のモデルを修正する必要があります。

## モデルの更新履歴

- 2023/4/21 bracket_sg90_v2.0を追加。<br>タカオ版専用基板へ対応するために穴を追加し寸法の変更を行った。
- 2023/3/29 bracket_sg90_v1.0 → bracket_sg90_v1.1<br>長い配線のままサーボを通せるように穴を追加。
