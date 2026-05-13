## Build and flash firmware

[日本語](./flashing-firmware_ja.md)

## Firmware architecture

If this is your first firmware flash, use the M5Stack StackChan CoreS3 standard configuration.
You need to decide three things:

- Device: the standard target is M5Stack StackChan CoreS3.
- What to flash: flash the host first; flash a MOD only when iterating on a small user application.
- Configuration: put Wi-Fi, servo, and other local settings in `stackchan/manifest_local.json` or a dedicated manifest when needed.

### Host and MOD

![firmware architecture](./images/host-and-mod.jpg)

Stack-chan's firmware consists of a program that provide the basic operation of Stack-chan (host), and a user application (mod).
Once the host is written, the mod can be installed in a short time for fast development.
Write the host first.
When you are iterating on a face or behavior extension, flash only the MOD as needed.
Flashing a MOD is much faster than rewriting the host.

### Manifest File

The host and the MOD each consist of a manifest file (manifest.json), source code for JavaScript modules, and resources such as images and audio. The manifest file includes the names and locations of the JavaScript modules (`modules`) , as well as the configurations that can be referenced within the modules (`config`). Additionally, the manifest file can include other manifest files (`include`).

For all configuration items, please refer to the [Moddable official documentation](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/tools/manifest.md).

## Configuration

StackChan can change settings such as motor types and pin assignments from the manifest file. You can modify [`stack-chan/firmware/stackchan/manifest_local.json`](../stackchan/manifest_local.json) for local settings. The following settings can be written under the `"config"` key.

| Key               | Description                                                                | Available values                     |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| driver.type       | Type of motor driver                                                       | "scservo", "rs30x", "pwm", "none", "dynamixel"    |
| driver.panId      | ID of the serial servo used for pan axis (horizontal rotation of the neck) | 1~254                                |
| driver.tiltId     | ID of the serial servo used for tilt axis (vertical rotation of the neck)  | 1~254                                |
| driver.offsetPan  | Offset of the pan axis                                                     | -90~90                               |
| driver.offsetTilt | Offset of the tilt axis                                                    | -90~90                               |
| tts.type          | [TTS](./text-to-speech.md) type                                            | "local", "voicevox", "remote", "voicevox-web", "elevenlabs", "openai"                  |
| tts.host          | Host name when TTS communicates with server                                | "localhost", "ttsserver.local", etc. |
| tts.port          | Port number when TTS communicates with server                              | 1~65535                              |
| tts.volume        | Volume when play TTS                                                       | 0~1                                  |

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

## Common Commands

Run these commands from the `stack-chan/firmware` directory.

| Task | Command |
| --- | --- |
| Check the environment | `npm run doctor` |
| Build the standard firmware | `npm run build` |
| Build and flash the standard firmware | `npm run flash` |
| Start and show logs in the terminal | `npm run debug` |
| Flash a MOD | `npm run mod -- mods/look_around/manifest.json` |

The standard target is M5Stack StackChan CoreS3.
For other M5Stack devices, use the named commands instead of target arguments.

| Device | Build | Flash | Debug |
| --- | --- | --- | --- |
| M5Stack Basic/Gray/Fire | `npm run build:basic` | `npm run flash:basic` | `npm run debug:basic` |
| M5Stack Core2 | `npm run build:core2` | `npm run flash:core2` | `npm run debug:core2` |
| M5Stack CoreS3 | `npm run build:cores3` | `npm run flash:cores3` | `npm run debug:cores3` |
| M5Stack StackChan CoreS3 | `npm run build:m5stackchan` | `npm run flash:m5stackchan` | `npm run debug:m5stackchan` |

## Writing the base program (host)

As stated above, Stack-chan's firmware comprises a base program (host) and a user application (MOD).
The following command builds and flashes the host.

_No `sudo` required for the command._

```console
$ npm run flash
```

Use `npm run build` when you only want to verify the build.
The program will be saved under the `$MODDABLE/build/` directory.

If written correctly, the face of Stack-chan will appear a few seconds after startup.
The M5Stack buttons will change Stack-chan's behavior as follows:

- **A Button** (in the case of CoreS3, the bottom-left area of the screen) ... Stack-chan will look in a random direction every 5 seconds.
- **B Button** (in the case of CoreS3, the bottom-center area of the screen) ... Stack-chan will look left, right, down, and up.
- **C Button** (in the case of CoreS3, the bottom-right area of the screen) ... The color of Stack-chan's face will invert.

## Debugging

You can start the program and show debug output in the terminal with:

```
$ npm run debug
```

This command uses `xs-dev run --log` for the selected Stack-chan platform. It is useful when you want to keep the workflow in the terminal and copy logs easily.
For breakpoint debugging and step-by-step execution, use Moddable's debugger `xsbug`; see the [official documentation](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/xs/xsbug.md).

## (Optional) Writing user application (mods)

The following command is used to build and write a mod.

_No `sudo` required for the command._

```console
$ npm run mod -- [mod manifest file path]
```

When you pass a MOD directory that contains `package.json`, the wrapper uses `mcpack mcrun` from the Moddable SDK.
Manifest-based sample MODs continue to use `mcrun`.

**Example: Installing [`mods/look_around`](../mods/look_around/)**

```console
$ npm run mod -- ./mods/look_around/manifest.json

> stack-chan@0.2.1 mod
> node scripts/firmware.mjs mod ./mods/look_around/manifest.json

# xsc mod.xsb
# xsc check.xsb
# xsc mod/config.xsb
# xsl look_around.xsa
Installing mod...complete
```

## (Optional)erase flash

After writing the MOD, if you want to revert to the behavior before the MOD was written, you can erase the written MOD with the following command.

> [!NOTE]  
> When you execute the command, it erases not only the MOD area but the entire flash area.  
> Please note that if you are using Preferences to write settings, those settings will also be erased.  
> Additionally, after executing the command, you will need to write to the host again.  

```console
$ npm run erase-flash

> stack-chan@0.2.1 erase-flash
> esptool.py erase_flash

esptool.py v4.8.dev4
Found 2 serial ports
Serial port /dev/cu.usbserial-01F05597
Connecting....
Detecting chip type... Unsupported detection protocol, switching and trying again...
Connecting.........
Detecting chip type... ESP32
Chip is ESP32-D0WDQ6-V3 (revision v3.0)
Features: WiFi, BT, Dual Core, 240MHz, VRef calibration in efuse, Coding Scheme None
Crystal is 40MHz
MAC: 8c:aa:b5:81:6c:1c
Uploading stub...
Running stub...
Stub running...
Erasing flash (this may take a while)...
Chip erase completed successfully in 25.4s
Hard reset
```

## Next Step

- [mods/README.md](../mods/README.md): The list of example mods
- [API](./api.md): API document
