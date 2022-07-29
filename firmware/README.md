# Stack-chan firmware

[日本語](./README_ja.md)

## NOTE

* The firmware part is under active development. Breaking changes to the API may occur.
* We are currently working on [issue](https://github.com/meganetaaan/stack-chan/issues/65) to make install steps more user friendly. Please post your feedback if any problem.
* If you are friendly with Arduino IDE, [stack-chan-tester](https://github.com/mongonta0716/stack-chan-tester) by @mongonta0716 is another option to try (only for PWM servo).

## Prerequisites

* Host computer
    * Tested on Linux(Ubuntu 20.04)
* M5Stack Basic
* USB type-C cable
* [ModdableSDK](https://github.com/Moddable-OpenSource/moddable)
    * See [Getting Started Doc](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/Moddable%20SDK%20-%20Getting%20Started.md)
* Node.js

### (Optional) Using Docker Image

This repository provides the build environment by Dockerfile. You can build, write and debug the firmware inside the Docker container. See [the instruction below](#optional-build-and-launch-docker-container).

## How to Build and Flash Firmware

### Clone this repo with submodules

```
git clone --recursive https://github.com/meganetaaan/stack-chan.git
cd stack-chan/firmware
```

### (Optional) Build and Launch Docker Container

#### Using terminal

```
$user@host# ./build-container.sh
$user@host# ./launch-container.sh
$root@container# npm install
```

#### Using VSCode Development Container (devcontainer)

* Open command palette
* Type and run `>Remote-Containers: Reopen in Container`

### Connect Stack-chan to Your Host Computer

![connect](./docs/images/connect.jpg)

### Build and Flash (w/o debug function)

```sh
# For M5Stack Basic/Gray/Fire
npm run deploy

# For M5Stack CORE2
npm run deploy:m5stack_core2
```

### Build, Flash and Debug

```sh
# For M5Stack Basic/Gray/Fire
npm run debug

# For M5Stack CORE2
npm run debug:m5stack_core2
```

This command flashes debug build to Stack-chan and launches `xsbug`, the debugger of ModdableSDK.
See [xsbug(the official docs)](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/xs/xsbug.md) for further details.

## Default App Usage

* __Button-A__: Show messages on balloon
* __Button-B__: Hide messages 
* __Button-C__: Toggle move/stop

## API

### TTS

See [text-to-speech.md](./docs/text-to-speech.md)
