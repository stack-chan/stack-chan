# Building and Flashing the Program

[日本語](./flashing-firmware-web_ja.md)

You can flash the Stack-chan firmware from a web browser without ModdableSDK environment.

## Prerequisites

* M5Stack USB driver is installed
* PC supports Web Serial API

## Steps

* Connect the M5Stack to your PC
* Access https://meganetaaan.github.io/stack-chan/web/flash/

![Flashing screen](./images/web-flash-top.png)

* Choose the type of M5Stack from the select box (M5Stack, M5Stack Fire, M5Stack Core2, M5Stack CoreS3)
* Choose "Flash Stack-chan firmware"

![Connection screen](./images/web-flash-connect.png)

* Choose Stack-chan's serial port (displayed as ttyUSB0, ttyACM0, etc.)

![Dashboard](./images/web-flash-dashboard.png)
![Confirmation screen](./images/web-flash-confirm.png)

* Choose "INSTALL STACK-CHAN" → "INSTALL"
* Wait for 2-3 minutes

![Flashing in progress](./images/web-flash-progress.png)

* Flashing complete!

![Flashing complete](./images/web-flash-complete.png)

## NOTE

The factory default settings are configured to use the SCS0009 servo.
If you wish to use a different type of servo, please refer to "[Changing Stack-chan settings from the browser](setting-preferences-web_ja.md)".
