# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stack-chan is a JavaScript-driven M5Stack-embedded robot. The codebase is primarily TypeScript/JavaScript built on the Moddable SDK platform for ESP32 microcontrollers.

## Core Architecture

### Modular Component System
- **Host Program**: Core firmware (`firmware/host/app/main.ts`) that provides the robot framework
- **MODs**: User applications that extend functionality (in `firmware/mods/` directory)
- **Drivers**: Hardware abstraction for different servo types (PWM, DYNAMIXEL, RS30X, SCServo)
- **UI modules**: Piu Application, views, drawer, status bar, bubbles, effects, and face components under `firmware/host/modules/ui`
- **TTS Engines**: Text-to-speech providers (local, remote, VoiceVox, ElevenLabs, OpenAI)
- **Services**: Background services (HTTP server, network, preferences)

### Key Directories
- `firmware/host/`: Core firmware source code
- `firmware/mods/`: Modular applications that can be loaded at runtime
- tests: Co-located under the target `firmware/host`, `firmware/mods`, or platform implementation
- `firmware/typings/`: TypeScript definitions for the Moddable platform
- `firmware/dist/`: Generated firmware programs and intermediate build files; do not edit or commit them
- `case/`: 3D printable robot case files
- `schematics/`: PCB designs for control boards

## Development Commands

All commands should be run from the `firmware/` directory:

### Setup and Installation
- `npm run setup` - Set up ModdableSDK and ESP-IDF using xs-dev
- `npm run setup -- --device=esp32` - Additional ESP32 setup
- `npm run doctor` - Check development environment status

### Building and Deployment
- `npm run build` - Build firmware for M5StackChan CoreS3 (default target)
- `npm run deploy` - Build and flash firmware to connected device
- `npm run debug` - Build and flash with debug mode
- `npm run mod` - Flash a MOD to already-deployed firmware (fast development cycle)
- `npm run bundle` - Create a bundle of the firmware
- `npm run clean` - Remove generated files under `firmware/dist`

### Firmware Build Output Contract

- Use the repository npm scripts instead of invoking `mcconfig`, `mcrun`, or `mcpack` directly. The wrappers supply the managed Moddable `-o` argument.
- Normal host, MOD, and test builds write programs to `firmware/dist/bin/` and intermediate files to `firmware/dist/tmp/`.
- The host application name is always `stack-chan-host`.
- Do not add a custom `-o`; repository commands reject it to keep worktree output isolated under `firmware/dist`.
- `npm run clean` removes all generated files under `firmware/dist`.
- `npm run bundle` is the exception: standard-device intermediate builds created internally by `mcbundle` remain under `$MODDABLE/build`. The Stack-chan-specific bundle target still uses `firmware/dist`.

### Code Quality
- `npm run lint` - Run Biome linter
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Check code formatting with Biome
- `npm run format:fix` - Auto-format code

### Device Management
- `npm run scan` - Scan for connected devices
- `npm run erase-flash` - Erase device flash memory

### Documentation and Testing
- `npm run generate-apidoc` - Generate API documentation with TypeDoc

## Target Configuration

The default target is M5StackChan CoreS3. Select other supported hardware through the named npm scripts, for example:

- `npm run build:stackchan_rt`
- `npm run build:takao_core2_sg90`
- `npm run flash:stackchan_rt`
- `npm run flash:takao_core2_sg90`

Do not use `--target` or `npm_config_target`; the firmware command wrapper rejects generic target overrides so that the matching platform and application manifest are selected together.

## MOD Development Workflow

1. Write MOD in `firmware/mods/` with `manifest.json` and `mod.js`
2. From `firmware/`, use `npm run mod -- mods/your-mod/manifest.json` for rapid iteration
3. MODs can add behavior via `onLaunch` and `onContextCreated` hooks

## Hardware Configuration

Configuration is managed through preferences system with these key areas:
- `driver`: Servo motor configuration (type: scservo, dynamixel, pwm, rs30x, none)
- `tts`: Text-to-speech engine selection
- `ui`: Piu UI and face selection
- `wifi`: Network configuration

## Git Hooks

Uses lefthook for pre-commit hooks:
- Automatically runs linting and formatting on staged files
- Install: `npm run install-hook`
- Uninstall: `npm run uninstall-hook`

## Testing Approach

Moddable test modules live under the target implementation with `manifest.test.json`; substantial tests get their own manifest for isolated execution.
Cheap constructor smokes are consolidated into shared manifests (`firmware/host/modules/__tests__/module-smoke`, `firmware/mods/examples/provider-dialogues/__tests__/dialogue-smoke`) because each manifest pays a full mcconfig build.
Node.js unit tests live next to pure helper implementations and run through `npm run test:unit`.
Prefer XS-driven Moddable tests for behavior that touches the platform (Piu, Timer, drivers); keep Node.js tests for pure logic.
Tests must exercise behavior — do not write tests that merely re-assert source text or manifest values; record such constraints as why-comments in the source instead.

## Pull Request Review Guidance

When reviewing a pull request:

- Confirm the PR description classifies release impact as `none`, `patch`, `minor`, or `major`
- Check whether user-visible firmware or web changes need a release note or changeset entry
- If no release note or changeset is needed, make sure the review states why
- For docs, CI, repository metadata, case, and schematics changes, verify release impact before requesting a release note or changeset
- Ask for tested targets, hardware-specific behavior, and reproduction or verification details when they affect release risk
