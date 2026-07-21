# Stack-chan shell model for Core2/AWS and SG90 with magnet latch feature
[日本語](./README_for_Magnetic_Case_Core2_AWS_SG90_ja.md) | English

# Notice
This model has been confirmed with M5Stack Core2/AWS and SG90 servo motor.
Other M5Stack models are potentially not compatible. Please check before molding.
This shell design doesn't require disassembly of M5Stack. 

# Appearance
![shell_SG90_magnet_latch](./docs/images/shell_SG90_magnet_latch.jpg)

The bracket structure has been revised from the previous version. The following updates are included:
1. The bracket structure has been reviewed so the servo wiring can be secured.
2. The structure now allows mounting a servo interface board (see below).
3. Magnet slot dimensions are optimized for Bambu P1S.

# Printing instructions
It is recommended to print the shell with the M5Stack mounting face down and to use tree supports.

![Sliced](docs/images/sliced.png)

# Assembly instructions
Insert magnets with 6 mm diameter and 2.5 mm thickness into the four magnet slots. These magnets are available at 100-yen/one-coin shops. Check the polarity of the magnets before installation. Refer to the image below for magnet placement.
![shell_SG90_magnet_latch](./docs/images/magnet_dimensions.png)

Route/form the servo cable as shown in the images below. No cable length adjustment is required.
![Cable forming1](docs/images/cable_forming1.jpg)
![Cable forming2](docs/images/cable_forming2.jpg)
![Cable forming3](docs/images/cable_forming3.jpg)

# Wiring
Use the Grove PORT servo connection board kit designed by Koumei-san:
[Grove PORT servo connection board kit (Booth)](https://b-sky-lab.booth.pm/items/5194419)
[Grove PORT servo connection board kit (GitHub)](https://github.com/kim-xps12/m5stack_board_grove_port_servo)

# Other required parts
An Unbuckled Grove Cable 10 cm is required for other wiring with M5Stack.
