# ｽﾀｯｸﾁｬﾝ 基板

[Enblish](./README.md)

<img box-sizing="border-box" margin="0px" display="inline-block" alt="board top" width="49%" src="./docs/images/m5-pantilt-top.png"/>
<img box-sizing="border-box" margin="0px" display="inline-block" alt="board bottom" width="49%" src="./docs/images/m5-pantilt-bottom.png"/>
<img box-sizing="border-box" margin="0px" display="inline-block" alt="board bottom" width="49%" src="./docs/images/m5-pantilt-sch.png"/>

## 機能

* 2つのサーボを駆動
  * PWM * 2chまたは
  * TTL * 2ch
* M5Unitのポートを搭載
  * PortB
  * PortC (PWMサーボ使用時のみ有効)
* 電池 (M5Stackからの充電に対応)
* (オプション) 電源スイッチ

## パーツリスト

__(注意)このリストは[PWM](#PWM-Servo)と[シリアル](#Serial(TTL)-Servo)のオプション両方を含んでいます。普通はどちらか一方のみ必要です。[組み立てインストラクション](#Assembly)を確認してください。

|リファレンス| 数量 | 値| フットプリント| URL|
|:--:|:--|:--|:--|:--|
| C1 C2 C3 C4 | 4	| "100u" | "Capacitor_SMD:C_1206_3216Metric_Pad1.42x1.75mm_HandSolder" | "https://akizukidenshi.com/catalog/g/gP-15633/" |
| J1 |1|"Conn_02x15_Odd_Even"|"Connector_PinHeader_2.54mm:PinHeader_2x15_P2.54mm_Vertical_SMD"|"https://www.switch-science.com/catalog/3654/"|
| J2 J3 |2|"Conn_02x03_Odd_Even"|"Connector_PinHeader_2.54mm:PinHeader_2x03_P2.54mm_Vertical"||
| J5 |1|"BAT"|"Connector_JST:JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical"|"https://akizukidenshi.com/catalog/g/gC-12802/"|
| J4 J6 |2|"Conn_01x04"|"Connector_JST:JST_PH_S4B-PH-K_1x04_P2.00mm_Horizontal"||
| J7 |1|"5V_POWER"|"Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical" |"https://akizukidenshi.com/catalog/g/gC-12802/" |
| JP1 JP2 JP3 JP4 JP5 JP6 JP7 JP8 JP9 JP10|10|Jumper_2_Open|Jumper:SolderJumper-2_P1.3mm_Open_Pad1.0x1.5mm||
| R1 R3 R4 R5 |4|"1k"|"Resistor_SMD:R_0603_1608Metric_Pad1.05x0.95mm_HandSolder"||
|R2 |1|100|"Resistor_SMD:R_0603_1608Metric_Pad1.05x0.95mm_HandSolder"|"https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-57FV"|
| Q1 |1|"IRLML6402"|Package_TO_SOT_SMD:SOT-23| "https://akizukidenshi.com/catalog/g/gI-02553/" |
|SW1 |1|"SW_SPDT"|"Button_Switch_THT:SW_CuK_OS102011MA1QN1_SPDT_Angled"|"https://www.digikey.jp/ja/products/detail/c-k/OS102011MA1QN1/1981430"|
| U1 |1|"NL27WZ125"|"NL27WZ125USG"|"https://www.digikey.jp/number/ja/on-semiconductor/488/NL27WZ125/291486"|

### PWMとシリアルサーボのどちらが良いか
#### PWMサーボ (SG90)
**Pros**: 低コスト
* 低コスト (~500円)で入手性が高いです。
* PortC (シリアル通信) が利用可能です。

**Cons**: 制御が難しい & 若干の安全性リスク有り
* サーボの角度をスムーズに変化させることが難しいです。
* 突入電流が大きく、まれにM5Stackの電源が落ちることがあります。例えば、ｽﾀｯｸﾁｬﾝの物理的な拘束を超えた角度司令を与えたときなどは、SG90が発熱したり発煙したりする場合があります。

#### シリアルサーボ (RS304MD)
**Pros**: 高機能
* 角速度制限などの複雑な制御が可能です。また、現在の角度情報を読み取れるので、ｽﾀｯｸﾁｬﾝの顔の向きに合わせて動作を変えるなど、高度な機能を実現できます。

**Cons**: 高コスト & サイズが大きい
* 高コスト (~3000円)
* PortCが利用できません。
* RS304MDはSG90より一回り大きいので、サーボが本体から少し飛び出た格好になります。

## 組み立て

### PWMサーボ

この設定ではPWMサーボを駆動できます。
下記でテスト済みです。

* [SG-90](https://www.towerpro.com.tw/product/sg90-7/)

#### パーツ

* チップ抵抗 表面実装 0603(1608Metric)
  * 1kΩ * 2pc
* チップコンデンサ 表面実装 100uF 1206(3216Metric) (定格電圧10V以上) * 2pc
* ピンヘッダ 2.54mm 1x3pin
  * 1行3列 * 2pc
* [ピンヘッダ 2.54mm 2x15pin](https://www.switch-science.com/catalog/3654/)
* **オプション: Groveポートコネクタ**
  * PH 4ピン コネクタ * 2pc
* **オプション: 電源スイッチ**
  * スライドスイッチ [OS102011MA1QN1](https://www.digikey.jp/ja/products/detail/c-k/OS102011MA1QN1/1981430)
  * チップ抵抗 表面実装 0603(1608Metric) 1kΩ * 1pc
  * Pch MOSFET [IRLML6402](https://akizukidenshi.com/catalog/g/gI-02553/)

#### はんだ付け

1. JP1とJP2をはんだブリッジします<br><img width="500px" src="./docs/images/pwm_jumper.jpg" />
1. Core1の場合JP5, JP7を、Core2の場合JP6, JP8をはんだブリッジします。
1. 1kΩの抵抗をR3とR4にはんだ付けします。
1. コンデンサをC1, C2, C3, C4にはんだ付けします。サーボそれぞれにつき、並列に付けた最大2つのコンデンサの容量合計が100uF程度かそれ以上になるのが望ましいです。（ドキュメントでは100uFのコンデンサを1つずつ付けています）
1. ピンヘッダJ2, J3とPH2ピン コネクタJ5をはんだ付けします。<br><img width="500px" src="./docs/images/pwm_parts.jpg" />
1. (オプション) PH4ピン コネクタをPortBとPortCにはんだ付けします。<br><img width="500px" src="./docs/images/pwm_ports.jpg" />
1. (オプション) 電源スイッチを使う場合、MOSFETをQ1に、1kΩの抵抗をR5に、スライドスイッチをSW1にはんだ付けします。<br><img width="500px" src="./docs/images/pwm_switch.jpg" />
  1. 電源スイッチを使わない場合、MOSFETのソース、ドレインを短絡します
1. 2x15ピンヘッダをはんだ付けします。<br><img width="500px" src="./docs/images/pwm_2x15.jpg" />
1. (オプション) サーボを動かす際にｽﾀｯｸﾁｬﾝの電源が切れる場合、ダイオードをD1にはんだ付けします。

### シリアル(TTL) サーボ

この設定ではシリアルサーボを駆動できます。
下記でテスト済みです。

* 双葉電子工業 [RS304MD](http://futaba.co.jp/robot/command_type_servos/rs304md)

#### Parts

* チップ抵抗 表面実装 0603(1608Metric)
  * 1kΩ * 1pc
  * 100Ω * 1pc
* チップコンデンサ 表面実装 100uF 1206(3216Metric) (定格電圧10V以上) * 2pc
* 3ステートバッファIC[NL27WZ125](https://www.digikey.jp/number/ja/on-semiconductor/488/NL27WZ125/291486) * 1pc
  * **または** [TC7WH241FK](https://akizukidenshi.com/catalog/g/gI-10884/) * 1pc
* ピンヘッダ 2.54mm 1x3pin
  * 1行3列 * 2pc または
  * 2行2列 * 2pc （サーボのコネクタ形状に合わせて選択）
* [ピンヘッダ 2.54mm 2x15pin](https://www.switch-science.com/catalog/3654/)
* JST PH2ピン コネクタ * 1pc
* **オプション: Groveポートコネクタ**
  * PH 4ピン コネクタ * 2pc
* **オプション: 電源スイッチ**
  * スライドスイッチ [OS102011MA1QN1](https://www.digikey.jp/ja/products/detail/c-k/OS102011MA1QN1/1981430)
  * チップ抵抗 表面実装 0603(1608Metric) 1kΩ * 1pc
  * Pch MOSFET [IRLML6402](https://akizukidenshi.com/catalog/g/gI-02553/)

#### Soldering

1. JP3, JP4をはんだブリッジします。<br><img width="500px" src="./docs/images/serial_jumper.jpg" />
1. 1kΩの抵抗をR1に、100Ωの抵抗をR2にはんだ付けします。
1. ICをはんだ付けします。チップ状の小さな穴がシルクの左上にくるのが正しい向きです。<br><img width="500px" src="./docs/images/serial_ic.jpg" />
1. JP9 **または** JP10をはんだブリッジします。
  - NL27WZ125を使う場合はJP9
  - TC7WH241FKを使う場合はJP10
1. コンデンサをC1, C2, C3, C4にはんだ付けします。サーボそれぞれにつき、並列に付けた2つのコンデンサの容量合計が100uF程度かそれ以上になるのが望ましいです。（ドキュメントでは100uFのコンデンサを2つ並列に接続します）
1. ピンヘッダとPH2ピン コネクタをはんだ付けします。<br><img width="500px" src="./docs/images/serial_header.jpg" />
1. (オプション) PH4ピン コネクタをPortBにはんだ付けします。<br><img width="500px" src="./docs/images/serial_ports.jpg" />
1. (オプション) 電源スイッチを使う場合、MOSFETをQ1に、1kΩの抵抗をR5に、スライドスイッチをSW1にはんだ付けします。<br><img width="500px" src="./docs/images/serial_switch.jpg" />
  1. 電源スイッチを使わない場合、MOSFETのソース、ドレインを短絡します
1. 2x15ピンヘッダをはんだ付けします。<br><img width="500px" src="./docs/images/serial_2x15.jpg" />
