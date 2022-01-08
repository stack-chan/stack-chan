# Stack-chan schematics

[日本語](./README_ja.md)

<img box-sizing="border-box" margin="0px" display="inline-block" alt="board top" width="49%" src="./docs/images/m5-pantilt-top.png"/>
<img box-sizing="border-box" margin="0px" display="inline-block" alt="board bottom" width="49%" src="./docs/images/m5-pantilt-bottom.png"/>
<img box-sizing="border-box" margin="0px" display="inline-block" alt="board bottom" width="49%" src="./docs/images/m5-pantilt-sch.png"/>

## Feature

* Drive two servos
  * PWM * 2ch or
  * Serial * 2ch
* M5Unit port
  * PortB
  * PortC (only available with PWM servo)
* Battery, which can be charged through M5Stack.
* (Optional) Power switch

## Parts list

__(NOTE) This list includes both options for [Serial](#Serial(TTL)-Servo) and [PWM](#PWM-Servo). You will only need eigher of them. See [assembly instruction](#Assembly).__

|Reference| Quantity| Value| Footprint| URL|
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

### Which type of servo should I use?
#### PWM (SG90)
**Pros**: Low cost
* Very low cost (~500yen), easy to find.
* PortC (serial communication) is available for users.

**Cons**: Difficult to control and having a (small) safety risk.
* Difficult to change its angle smoothly.
* Inrush current is high and may cause the M5Stack to power down in rare cases. SG90 possibly get very hot and may emit smoke when overloaded, such as when the angle exceeds the physical limits of the stack-chan.

#### Serial (RS304MD)
**Pros**: High functionality
* Complex control such as speed limit is possible. Since the current servo angle can be read, we can make rich functions such as changing the action according to the direction of the stuck-chan's face.

**Cons**: High cost and having a bit large size.
* It is relatively expensive (~3,000 yen)
* Users cannot use PortC. 
* Because RS304MD is a bit larger than SG90, it sticks out slightly behind the body.

## Assembly

### PWM Servo

With this settings the board can drive two PWM Servos.
Tested with:

* [SG-90](https://www.towerpro.com.tw/product/sg90-7/)

#### Parts

* Resistor SMD 0603(1608Metric)
  * 1kΩ * 2pc
* Capacitor 100uF 1206(3216Metric) (Rated Voltage >= 10V) * 2pc
* Pin Header 2.54mm 1x3pin
  * 1row-3column * 2pc
* [Pin Header 2.54mm 2x15pin](https://www.switch-science.com/catalog/3654/)
* JST PH 2-pin Connector * 1pc
* **Optional: Grove port connector**
  * PH 4-pin Connector * 2pc
* **Optional: Power switch**
  * Slide switch [OS102011MA1QN1](https://www.digikey.jp/ja/products/detail/c-k/OS102011MA1QN1/1981430)
  * Resistor SMD 0603(1608Metric) 1kΩ * 1pc
  * Pch MOSFET [IRLML6402](https://akizukidenshi.com/catalog/g/gI-02553/)

#### Soldering

CAUTION: The image of instruction below is deprecated(v0.1.0). To be rewritten when the new board arrives.

1. Solder bridge JP1 and JP2
1. For Core1, solder JP5 and JP7, and for Core2, solder JP6 and JP8.
1. Solder 1kΩ resistor on R3 and R4.
1. Solder the capacitors to C1, C2, C3, and C4. For each servo, the total capacitance of the two capacitors in parallel should be about 100uF or more. (In this document, two 100uF capacitors are connected in parallel.)
1. Solder pin headers. and PH 2-pin connector<br><img width="500px" src="./docs/images/pwm_header.jpg" />
1. (Optional) Solder PH 4-pin connectors for PortB and PortC
1. (Optional) When using the power switch, solder the MOSFET to Q1, the 1kΩ resistor to R5, and the slide switch to SW1.
  1. When not, short-circuit the source and drain of the MOSFET.
1. Solder 2x15 pin header<br><img width="500px" src="./docs/images/pinheader.jpg" />
1. (Optional) If the power of the stack chamber is cut off when the servo is moved, solder a diode to D1. Solder the diode to D1.

### Serial(TTL) Servo

With this settings the board can drive two Serial(TTL) Servos.
Tested with:

* Futaba [RS304MD](http://futaba.co.jp/robot/command_type_servos/rs304md)

#### Parts

* Resistor SMD 0603(1608Metric)
  * 1kΩ * 1pc
  * 100Ω * 1pc
* Capacitor 100uF 1206(3216Metric) (Rated Voltage >= 10V) * 2pc
* 3-State Buffer IC [NL27WZ125](https://www.digikey.jp/number/ja/on-semiconductor/488/NL27WZ125/291486) * 1pc
* Pin Header 2.54mm 1x3pin that matches the connector shape of the servos.
  * 1row-3column * 2pc OR
  * 2row-2column * 2pc
* [Pin Header 2.54mm 2x15pin](https://www.switch-science.com/catalog/3654/)
* JST PH 2-pin Connector * 1pc
* **Optional: Grove port connector**
  * PH 4-pin Connector * 2pc
* **Optional: Power switch**
  * Slide switch [OS102011MA1QN1](https://www.digikey.jp/ja/products/detail/c-k/OS102011MA1QN1/1981430)
  * Resistor SMD 0603(1608Metric) 1kΩ * 1pc
  * Pch MOSFET [IRLML6402](https://akizukidenshi.com/catalog/g/gI-02553/)

#### Soldering

CAUTION: The image of instruction below is deprecated(v0.1.0). To be rewritten when the new board arrives.

1. Solder bridge JP3 and JP4
1. Solder resistors, 1kΩ on R1 and 100Ω on R2
1. Solder IC. See the tiny hole on the chip is on top-left side of silk
1. Solder the capacitors to C1, C2, C3, and C4. For each servo, the total capacitance of the two capacitors in parallel should be about 100uF or more. (In this document, two 100uF capacitors are connected in parallel.)
1. Solder pin headers. and PH 2-pin connector<br><img width="500px" src="./docs/images/pwm_header.jpg" />
1. (Optional) Solder PH 4-pin connectors for PortB
1. (Optional) When using the power switch, solder the MOSFET to Q1, the 1kΩ resistor to R5, and the slide switch to SW1.
  1. When not, short-circuit the source and drain of the MOSFET.
1. Solder 2x15 pin header<br><img width="500px" src="./docs/images/pinheader.jpg" />
