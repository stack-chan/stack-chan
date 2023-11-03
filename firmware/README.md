# Stack-chan firmware

[日本語](./README_ja.md)

## NOTE

* __To those who arrived here looking for AI Stack-chan__ You may not find the information you're looking for here! "AI Stack-chan" is an Arduino-based application under development, primarily by @robo8080.
    * https://github.com/robo8080/AI_StackChan2
* The firmware part is under active development. Breaking changes to the API may occur.
* We are currently working on [issue](https://github.com/meganetaaan/stack-chan/issues/65) to make install steps more user friendly. Please post your feedback if any problem.
* If you are friendly with Arduino IDE, [stack-chan-tester](https://github.com/mongonta0716/stack-chan-tester) by @mongonta0716 is another option to try (only for PWM servo).

## Features

* Programming possible using JavaScript
* Supports multiple types of servo motors (Feetech, FUTABA, DYNAMIXEL, PWM servo)
* Supports cloud-based text-to-speech (VOICEVOX, ElevenLabs)
* Designed with separate host program and user applications (MODs). Flashing only MODs is very fast, allowing for an efficient development cycle.
* [Supports firmware flashing from a web browser](docs/flashing-firmware-web_ja.md)

## Directory structure

- [stackchan](./stackchan/): Firmware source code.
- [mods](./mods/): Source code of mods.
- [scripts](./scripts/): Scripts for Stack-chan's voice synthesis, etc.
- [extern](./extern/): External modules.
- [typings](./typings/): TypeScript type definition files (d.ts).
    - Stack-chan firmware is implemented in TypeScript, so no separate type definition files are needed.

## Documents

- [Building Environment](docs/getting-started.md)
- [Building and Writing Programs](docs/flashing-firmware.md)
- [API](docs/api.md)
- [MOD](mods/README.md)
