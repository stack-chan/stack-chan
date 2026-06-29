# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stack-chan is a JavaScript-driven M5Stack-embedded robot. The codebase is primarily TypeScript/JavaScript built on the Moddable SDK platform for ESP32 microcontrollers.

## Core Architecture

### Modular Component System
- **Host Program**: Core firmware (`host/app/main.ts`) that provides the robot framework
- **MODs**: User applications that extend functionality (in `mods/` directory)
- **Drivers**: Hardware abstraction for different servo types (PWM, DYNAMIXEL, RS30X, SCServo)
- **UI modules**: Piu Application, views, drawer, status bar, bubbles, effects, and face components under `host/modules/ui`
- **TTS Engines**: Text-to-speech providers (local, remote, VoiceVox, ElevenLabs, OpenAI)
- **Services**: Background services (HTTP server, network, preferences)

### Key Directories
- `host/`: Core firmware source code
- `mods/`: Modular applications that can be loaded at runtime
- tests: Co-located under the target `host`, `mods`, or platform implementation
- `typings/`: TypeScript definitions for the Moddable platform
- `case/`: 3D printable robot case files
- `schematics/`: PCB designs for control boards

## Development Commands

All commands should be run from the `firmware/` directory:

### Setup and Installation
- `npm run setup` - Set up ModdableSDK and ESP-IDF using xs-dev
- `npm run setup -- --device=esp32` - Additional ESP32 setup
- `npm run doctor` - Check development environment status

### Building and Deployment
- `npm run build` - Build firmware for esp32/m5stack (default target)
- `npm run deploy` - Build and flash firmware to connected device
- `npm run debug` - Build and flash with debug mode
- `npm run mod` - Flash a MOD to already-deployed firmware (fast development cycle)
- `npm run bundle` - Create a bundle of the firmware

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

The build system uses environment variables to specify target platforms:
- Default target: `esp32/m5stack`
- Override with: `npm_config_target=esp32/m5stack_core2 npm run build`

## MOD Development Workflow

1. Write MOD in `mods/` directory with `manifest.json` and `mod.js`
2. Use `npm run mod mods/your-mod/manifest.json` for rapid iteration
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

Moddable test modules live under the target implementation with `manifest.test.json` for isolated execution.
Node.js unit tests live next to pure helper implementations and run through `npm run test:unit`.

## Pull Request Review Guidance

When reviewing a pull request:

- Confirm the PR description classifies release impact as `none`, `patch`, `minor`, or `major`
- Check whether user-visible firmware or web changes need a release note or changeset entry
- If no release note or changeset is needed, make sure the review states why
- For docs, CI, repository metadata, case, and schematics changes, verify release impact before requesting a release note or changeset
- Ask for tested targets, hardware-specific behavior, and reproduction or verification details when they affect release risk
