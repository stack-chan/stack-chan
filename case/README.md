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
    * [RS30X series(TTL version)](https://www.vstone.co.jp/robotshop/index.php?main_page=product_info&products_id=2685) serial servo
    * [SCS0009(TTL version)](https://www.switch-science.com/catalog/8042/) serial servo
    * [SG-90 pwm servo](https://akizukidenshi.com/catalog/g/gM-08761/)
* 3.7V Battery with PH 2-pin cable
  * Tested on:
    * [lithium polymer 400mAh battery](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-4YZL))
    * [lithium polymer 640mAh battery](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-5GHY))
* Screws
  * M2 4mm * 4pcs
  * M2 8mm * 2pcs
  * (Optional) M3 15mm * 2本

### Serial Servo Setup

Serial servos share a signal line. It's necessary to specify ID for controlling each servo.
Therefore, different IDs must be assigned in advance.

- ID1: Foot side (left-right rotation, pan axis)
- ID2: Face side (vertical rotation, tilt axis)

The serial servo driver has a command `flashId` to rewrite IDs](https://github.com/meganetaaan/moddable-scservo/blob/71292b9358353837a74ecea387cd3265a 610479f/src/scservo.ts#L274). A servo configuration tool using this command is under development.

For SCServo, a GUI debugging tool can be downloaded from [Feetech's repository on gitee](https://gitee.com/ftservo/fddebug).

### About the angle of the servo

The angle of the servo mounting should be as follows.

- The center of the movable range is the reference angle (the angle when the stack chan faces forward).
- Install the servo so that the convex of the cross-shaped servo horn is aligned with the reference angle.
- If the servo is installed in the wrong direction, it will interfere with the stack chamber housing and will not operate properly.
  - We recommend that you check the operation of the servo by writing the firmware once before fixing the servo to the case.
- The movable range and reference angle are different for each servo type (see the following table).

|Servo |Movable range |Reference angle |
|:------|:---------|:------|
|SG-90 |0~180 degrees |90 degrees |
|RS30X |-150~150 degrees |0 degrees |
|SCS0009|0~200 degrees |100 degrees |

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
  * For serial servos, the servo with ID: 1 is for the foot side (pan axis) and the servo with ID: 2 is for the face side (tilt axis).
* Fix the board on the robot with screws(M2-4mm * 4pcs)
* Stack M5Stack on the robot.
* If you want to fix the M5Stack, use the two holes below to screw(M3-15mm * 2pcs) it in place.
