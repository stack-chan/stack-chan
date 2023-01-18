# Stack-chan firmware

[日本語](./README_ja.md)

## NOTE

* The firmware part is under active development. Breaking changes to the API may occur.
* We are currently working on [issue](https://github.com/meganetaaan/stack-chan/issues/65) to make install steps more user friendly. Please post your feedback if any problem.
* If you are friendly with Arduino IDE, [stack-chan-tester](https://github.com/mongonta0716/stack-chan-tester) by @mongonta0716 is another option to try (only for PWM servo).

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
