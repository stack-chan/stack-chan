# Stack-chan case for SG90 or MG90S

![case_sg90_m5core2](./docs/images/case_sg90_m5core2.jpg)
![case_sg90_m5stackbasic](./docs/images/case_sg90_m5stackbasic.jpg)

Currently the [case data](./case_for_SG90andM5GoBottomBoard/) is developed with Fusion360 and modified with DesighSparkMechanical.

## Assembly

### Parts

* 3D-printed cases
  * Shell( There are 2 type for M5StackBasic/Gray Bottom or M5GoBottom(1or2).)
  * Feet
  * Bracket( There are 2 types for SG90 or MG90S) 
* M5Stack Core Basic/Gray/Go/Fire M5Stack Core2(+ M5Bottom2)

* Board and Battery
  * M5GoBottom or M5Stack Basic/Gray's Bottom<br>When using the M5Stack's internal battery, the servos may not move and reset, so the Stack-chan board is recommended. Alternatively, make sure you have a separate power supply for the servos.
  * (Recommended)[Stack-chan board](../schematics/README.md)
    * Battery with PH 2-pin cable (tested with [lithium polymer 400mAh battery](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-4YZL))
* Two servos
  * Currently available on:
    * SG-90 pwm servo
    * MG-90S pwm servo<br>Note that there are also fake MG90S on the market that are similar in size to SG90.
* Screws
  * M2 4mm * 8pcs 
  * M2 8mm * 2pcs
  * Screws included with the Servo(2 set)
  * for M5GoBottom
    * M3 18mm * 2pcs
    * M3 15mm * 2pcs(for M5Stack Core2 only)
  * for M5Stack Basic/Gray's Bottom
    * M3 18mm * 2pcs 
* Nuts
  * M2 * 2pcs

### How to Assemble

(Here are the steps with RS304MD servo. SG-90 is similar to them)

![assembly steps](./docs/images/assembly.png)

#### Bracket

![step1](./docs/videos/bracket.gif)

* Remove four screws from the servo. Be careful not to get any dust inside the servo housing.
* Insert the servo into bracket and fix with four screws. Then attach the horn.
* Fix the servo(SG90 or MG90S) that moves up and down with an M2 8mm screw and nut. (To prevent damage to the bracket) Fix the left/right (turning) servo with the screws provided with the servo.

#### Shell and Feet

![step2](./docs/videos/shell_and_feet.gif)

* Fix feet and shell with screws(M2-4mm * 4pcs, Screw attached to servo(SG90 or MG90S) * 1pc for each of them).

#### M5Stack and board

![step3](./docs/videos/m5stack_and_board.gif)

* Insert battery into the pocket of bracket.
* Connect servo and battery cables to the board. Double check the direction of each connector is correct.
* Fix the board on the robot with screws(Screws that came with the Bottom of the M5Stack)
* Stack M5Stack on the robot and Fix them with screws(M3-18mm * 2pcs). 
* In the case of the M5Stack Core2, the top can also be fixed with screws(M3-15mm * 2pcs).
