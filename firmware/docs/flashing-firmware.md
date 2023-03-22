## Build and flash firmware

[日本語](./flashing-firmware_ja.md)

## Firmware architecture

### Host and MOD

![firmware architecture](./images/host-and-mod.jpg)

Stack-chan's firmware consists of a program that provide the basic operation of Stack-chan (host), and a user application (mod).
Once the host is written, the mod can be installed in a short time for fast development.
First write the host, and then write the mods as needed.

### Manifest File

The host and the MOD each consist of a manifest file (manifest.json), source code for JavaScript modules, and resources such as images and audio. The manifest file includes the names and locations of the JavaScript modules (`modules`) , as well as the configurations that can be referenced within the modules (`config`). Additionally, the manifest file can include other manifest files (`include`).

For all configuration items, please refer to the [Moddable official documentation](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/tools/manifest.md).

## Configuration

StackChan can change settings such as motor types and pin assignments from the manifest file. You can modify [`stack-chan/firmware/stackchan/manifest_local.json`](../stackchan/manifest_local.json) for local settings. The following settings can be written under the `"config"` key.

| Key             | Description                                     | Available values                            |
| --------------- | ----------------------------------------------- | ------------------------------------------- |
| driver.type     | Type of motor driver                            | "scservo", "rs30x", "pwm", "none"           |
| driver.panId    | ID of the serial servo used for pan axis (horizontal rotation of the neck) | 1~254                                       |
| driver.tiltId   | ID of the serial servo used for tilt axis (vertical rotation of the neck) | 1~254                                       |
| driver.offsetPan  | Offset of the tilt axis                            | -90~90                                      |
| driver.offsetTilt | Offset of the tilt axis                            | -90~90                                      |
| tts.type          | [TTS](./text-to-speech.md) type                                      | "local", "voicevox"                         |
| tts.host          | Host name when TTS communicates with server           | "localhost", "ttsserver.local", etc. |
| tts.port          | Port number when TTS communicates with server          | 1~65535                                     |

Additionally, you can specify the paths of other manifest files in a list format under the `"include"` key.

### Configuration Example: the Stack-chan M5Bottom Kit

This is an example configuration for running [Stack-chan Assembly Kit M5Bottom Version](https://mongonta.booth.pm/) distributed by Takao Akaki ([@mongonta0716](https://github.com/mongonta0716)) with the firmware in this repository. The M5Bottom version does not use a dedicated board, but connects to the M5Bottom port and servo.

When using Port.A of M5Stack Core2:

`manifest_local.json`
```json
{
    // ...
    "config": {
        "driver": {
            "type": "pwm",
            "pwmPan": 33,
            "pwmTilt": 32
        }
    }
}
```

When using Port.C of M5Stack Core2:

`manifest_local.json`
```json
{
    // ...
    "config": {
        "driver": {
            "type": "pwm",
            "pwmPan": 13,
            "pwmTilt": 14
        }
    }
}
```

When using Port.C of M5Stack Basic:

`manifest_local.json`
```json
{
    // ...
    "config": {
        "driver": {
            "type": "pwm",
            "pwmPan": 16,
            "pwmTilt": 17
        }
    }
}
```

If Stack-chan is shaking her head left and right, the configuration has been successful.

Reference: [About the firmware for Stack-chan M5Go Bottom version (Japanese)](https://raspberrypi.mongonta.com/softwares-for-stackchan/)

### Configuration example: increase mod write space

Moddable currently doesn't have an SD Card driver, so resources like audio and images are compiled and saved within the mod itself.
However, if you have a lot of audio files, the mod may not be able to write beyond the default partition size of 4MB on the stack chan due to limitations.

If you have a recent M5Stack with 16MB of Flash,
you can include the [stackchan/manifest_8mb_flash.json](. /stackchan/manifest_8mb_flash.json) file
to increase the size of the partition where the mod is saved.

Simply add the following code to your manifest file:

```json
{
    "include": [". /manifest_8mb_flash.json"],
}
```

## Writing hosts

The following commands are used to build and write a host.

```console
# For M5Stack Basic/Gray/Fire
$ npm run build
$ npm run deploy

# For M5Stack CORE2
$ npm run build --target=esp32/m5stack_core2
$ npm run deploy --target=esp32/m5stack_core2
```

The program will be saved under the `$MODDABLE/build/` directory.

## Writing MODs

The following command is used to build and write a mod.

```console
# For M5Stack Basic/Gray/Fire
$ npm run mod [mod manifest file path]

# For M5Stack Core2
$ npm run mod --target=esp32/m5stack_core2 [mod manifest file path]
```

__Example: Installing [`mods/look_around`](../mods/look_around/)__

```console
$ npm run mod ./mods/look_around/manifest.json

> stack-chan@0.2.1 mod
> mcrun -d -m -p ${npm_config_target=esp32/m5stack} ${npm_argument} "./mods/look_around/manifest.json"

# xsc mod.xsb
# xsc check.xsb
# xsc mod/config.xsb
# xsl look_around.xsa
Installing mod...complete
```

## Next Step

- [mods/README.md](../mods/README.md): The list of example mods
- [API](./api.md): API document
