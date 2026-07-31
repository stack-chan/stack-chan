# Stack-chan firmware

[日本語](./README_ja.md)

## About this firmware

The M5Stack factory firmware preinstalled on M5StackChan and the Stack-chan firmware in this repository are separate software.
Use the [latest release](https://github.com/stack-chan/stack-chan/releases/latest) when you need a stable environment.
The default `develop` branch may change internal structures and APIs while preparing the next release.

AI Stack-chan is a separate Arduino-based application developed primarily by @robo8080.
If you are looking for AI Stack-chan, see [AI_StackChan2](https://github.com/robo8080/AI_StackChan2).

If you are comfortable with the Arduino IDE and use PWM servos, [stack-chan-tester](https://github.com/mongonta0716/stack-chan-tester) by @mongonta0716 is another option.

## Try it in a browser

For a first trial, the [Stack-chan browser tools](https://stack-chan.github.io/stack-chan/web/) let you start without installing a local development environment.

1. Connect M5StackChan to a computer with a data-capable USB cable.
2. Open the [Web firmware installer](https://stack-chan.github.io/stack-chan/web/flash/) in Chrome or Edge, select "M5StackChan CoreS3," and install the firmware.
3. Choose a MOD from the [MOD Gallery](https://stack-chan.github.io/stack-chan/web/mod-gallery/) and try it in the simulator or on the device.

> [!IMPORTANT]
> Flashing this firmware replaces the factory firmware supplied by M5Stack.
> To restore it, follow the restore procedure in the [M5Stack product documentation](https://docs.m5stack.com/en/StackChan) and use M5Burner.

## Start local development

The standard firmware target is M5StackChan CoreS3.
To change the source code, run these commands from the `firmware` directory:

```console
$ npm i
$ npm run setup
$ npm run doctor
$ npm run flash
```

`npm run flash` builds and flashes the standard host.
For Stack-chan RT or Takao Core2 + SG90, use `npm run flash:stackchan_rt` or `npm run flash:takao_core2_sg90`.
When iterating on a MOD, pass the MOD manifest: `npm run mod -- mods/examples/look_around/manifest.json`.
The command builds the archive without the xsbug install channel, then discovers and writes the device's `xs` partition with `esptool`.
The installed host may therefore be either a debug or release build.

## Features

- Develop MODs in JavaScript or TypeScript.
- Update a MOD quickly without rebuilding the host because the host program and MODs are separate.
- Use capability-oriented context APIs for faces, motion, input, audio, camera, and connectivity.
- Support multiple motor configurations, including Feetech, FUTABA, DYNAMIXEL, and PWM servos.
- Use text-to-speech through Stack-chan Voice, VOICEVOX, ElevenLabs, or OpenAI.
- Access firmware installation, BLE preferences, the MOD Gallery, the block editor, the face editor, and the WebAssembly simulator from a browser.
- Use the firmware and Web UI in Japanese, English, or Simplified Chinese.

## Build output

Use the repository npm scripts for firmware development. They manage the Moddable output directory and keep normal host, MOD, and test build artifacts under `firmware/dist/`:

- Programs are written under `firmware/dist/bin/` and intermediate files under `firmware/dist/tmp/`.
- The host application name is `stack-chan-host`.
- `npm run clean` removes all generated files under `firmware/dist/`.
- Do not pass a custom `-o` or invoke `mcconfig`, `mcrun`, or `mcpack` directly when using the repository workflow.
- `npm run bundle` builds every release target under `firmware/dist/`, stages validated target artifacts in `firmware/dist/bundle-targets/`, and writes the assembled directory and ZIP under `firmware/host/app/`.
- Use the named `build:release:<target>` scripts for individual release builds; CI uses the same scripts before `bundle:package` assembles their artifacts.

See [Building and Writing Programs](docs/flashing-firmware.md) for target-specific commands and detailed output paths.

## Directory structure

- [host](./host/): Host application and firmware modules.
- [mods](./mods/): Source code of mods.
- [scripts](./scripts/): Scripts for Stack-chan's voice synthesis, etc.
- [typings](./typings/): TypeScript type definition files (d.ts).
    - Stack-chan firmware is implemented in TypeScript, so no separate type definition files are needed.
- `dist/`: Generated firmware programs and intermediate build files. This directory is managed by the build scripts and ignored by Git.

## Documents

### Use the browser tools

- [Browser tools](https://stack-chan.github.io/stack-chan/web/)
- [Flash firmware from a browser](docs/flashing-firmware-web.md)
- [Change preferences from a browser](docs/setting-preferences-web.md)
- [MOD Gallery](https://stack-chan.github.io/stack-chan/web/mod-gallery/)

### Develop locally

- [Set up the development environment](docs/getting-started.md)
- [Build and flash programs](docs/flashing-firmware.md)
- [API](docs/api.md)
- [MODs](mods/README.md)
- [Localization](docs/localization.md)
- [Mini apps (Japanese)](docs/mini-apps_ja.md)
- [v1.0.0 release notes](../docs/release-notes/v1.0.0.md)
