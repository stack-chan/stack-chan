# Stack-chan case

[日本語](./README_ja.md)

![case](./docs/images/case.jpg)
![case_inside](./docs/images/case_inside.jpg)

Currently the [case data](https://a360.co/3gcw960) is developed with Fusion360.

## Assembly

### Parts

* 3D-printed cases
  * Shell
  * Feet
  * Bracket
  * Battery backpack
* M5Stack Core Basic/Gray/Go/Fire
* [Stack-chan board](../schematics/README.md)
* Two servos
  * Currently available on:
    * RS30X series(TTL version) serial servo
    * [SG-90 pwm servo](https://akizukidenshi.com/catalog/g/gM-08761/)
* 3.7V Battery with PH 2-pin cable
  * Tested on:
    * [lithium polymer 400mAh battery](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-4YZL))
    * [lithium polymer 640mAh battery](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-5GHY))
* Screws
  * M2 4mm * 4pcs
  * M2 8mm * 2pcs

### How to Assemble

(Here are the steps with RS304MD servo. SG-90 is similar to them)

#### Bracket and Battery backpack

![step1](./docs/videos/bracket.gif)

* Snap two servos into the bracket.
* Insert battery into the backpack.
* Insert the battery pack into the bracket by hooking the claws.

#### Shell and Feet

![step2](./docs/videos/shell_and_feet.gif)

* Fix feet and shell with screws(M2-8mm * 1pc for each of them).

#### M5Stack and board

![step3](./docs/videos/m5stack_and_board.gif)

* Connect servo and battery cables to the board. Double check the direction of each connector is correct.
* Fix the board on the robot with screws(M2-4mm * 4pcs)
* Stack M5Stack on the robot.
