## Build and flash firmware

[日本語](./flashing-firmware_ja.md)

## Firmware architecture

### Host and MOD

![firmware architecture](./images/host-and-mod.jpg)

Stack-chan's firmware consists of a program that provide the basic operation of Stack-chan (host), and a user application (mod).
Once the host is written, the mod can be installed in a short time for fast development.
First write the host, and then write the mods as needed.
When no MOD is installed, the host runs the product default behavior.
When a MOD is installed, that MOD replaces the product default behavior and receives the runtime context through `onContextCreated`.

### Manifest File

The host and the MOD each consist of a manifest file (manifest.json), source code for JavaScript modules, and resources such as images and audio. The manifest file includes the names and locations of the JavaScript modules (`modules`) , as well as the configurations that can be referenced within the modules (`config`). Additionally, the manifest file can include other manifest files (`include`).

For all configuration items, please refer to the [Moddable official documentation](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/tools/manifest.md).

## Configuration

StackChan can change settings such as motor types and pin assignments from the manifest file. You can modify [`stack-chan/firmware/host/app/manifest_local.json`](../host/app/manifest_local.json) for local settings. The following settings can be written under the `"config"` key.

`manifest_local.json` is intentionally checked in with an empty `"config"` object so private IP addresses, API keys, and bench-specific servo settings are not committed. If you build without adding local driver settings, the firmware uses the platform/app defaults. On a generic bench build this may select the default serial servo driver, so set `config.driver.type` explicitly when your hardware uses a different driver.

| Key               | Description                                                                | Available values                     |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| driver.type       | Type of motor driver                                                       | "m5stackchan", "scservo", "rs30x", "pwm", "none", "dynamixel"    |
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

## Writing the base program (host)

As stated above, Stack-chan's firmware comprises a base program (host) and a user application (MOD).
The following command builds and flashes the standard M5StackChan CoreS3 host.

_No `sudo` required for the command._

```console
$ npm run flash
```

Use `npm run build` when you only want to verify the standard build.
The `build`, `flash`, and `deploy` scripts use release mode by default on every supported subplatform.
Pass `--mode=debug` or `--mode=instrument` explicitly when that mode is required.
The program and intermediate files are saved under `firmware/dist/bin/` and `firmware/dist/tmp/`.
The host application name is `stack-chan-host`.
Run `npm run clean` to remove all generated files under `firmware/dist/`.
`npm run bundle` also keeps every target build under `firmware/dist/`, stages validated target artifacts under
`firmware/dist/bundle-targets/`, and writes the assembled directory and ZIP under `firmware/host/app/`.

### Stack-chan subplatforms

Stack-chan hardware variants ship their own **subplatform**, which already defines the servo driver type and bus pins. Use the board-specific npm scripts below instead of generic `--target=` commands; each one selects the subplatform (`-p esp32:./host/platforms/<board>`) and its matching app manifest automatically.

| Task                    | M5StackChan CoreS3 | Stack-chan RT | Takao Core2 + SG90 |
| ----------------------- | ------------------ | ------------- | ------------------ |
| Build only              | `npm run build` or `npm run build:m5stackchan_cores3` | `npm run build:stackchan_rt` | `npm run build:takao_core2_sg90` |
| Build and flash         | `npm run flash` or `npm run flash:m5stackchan_cores3` | `npm run flash:stackchan_rt` | `npm run flash:takao_core2_sg90` |
| Run deploy task         | `npm run deploy` or `npm run deploy:m5stackchan_cores3` | `npm run deploy:stackchan_rt` | `npm run deploy:takao_core2_sg90` |
| Debug (xsbug)           | `npm run debug` or `npm run debug:m5stackchan_cores3` | `npm run debug:stackchan_rt` | `npm run debug:takao_core2_sg90` |
| Debug (xsdb)            | `npm run debug:xsdb` or `npm run debug:xsdb:m5stackchan_cores3` | `npm run debug:xsdb:stackchan_rt` | `npm run debug:xsdb:takao_core2_sg90` |
| Install a MOD           | `npm run mod -- [mod manifest]` or `npm run mod:m5stackchan_cores3 -- [mod manifest]` | `npm run mod:stackchan_rt -- [mod manifest]` | `npm run mod:takao_core2_sg90 -- [mod manifest]` |

The board-specific driver type and servo bus pins live in each subplatform manifest:

- M5StackChan CoreS3: [`host/platforms/m5stackchan_cores3/manifest.json`](../host/platforms/m5stackchan_cores3/manifest.json) — `m5stackchan` driver, serial TX6 / RX7.
- Stack-chan RT: [`host/platforms/stackchan_rt/manifest.json`](../host/platforms/stackchan_rt/manifest.json) — `dynamixel` driver, serial TX7 / RX6.
- Takao Core2 + SG90: [`host/platforms/takao_core2_sg90/manifest.json`](../host/platforms/takao_core2_sg90/manifest.json) — `pwm` driver, pan PWM19 / tilt PWM27.

The `m5stackchan` driver adds M5StackChan-specific zero positions, motion limits, and PY32 servo-power control on top of the SCServo protocol. For safety, M5StackChan CoreS3 firmware locks the driver type to `m5stackchan`, while Stack-chan RT firmware locks it to `dynamixel`. Both ignore a different stored `driver.type`.

Put per-device settings such as Wi-Fi credentials and API keys in the board's app manifest under `"config"`. Keep secrets out of commits and add them locally only. On boot, the log line `[dynamixel] serial port=1 tx=7 rx=6 baud=1000000` shows the RT serial pins actually in use.

If written correctly, the face of Stack-chan will appear a few seconds after startup.
With the product default behavior, the M5Stack buttons change Stack-chan's behavior as follows:

- **A Button** (in the case of CoreS3, the bottom-left area of the screen) ... Stack-chan will look in a random direction every 5 seconds.
- **B Button** (in the case of CoreS3, the bottom-center area of the screen) ... Stack-chan will look left, right, down, and up.
- **C Button** (in the case of CoreS3, the bottom-right area of the screen) ... The color of Stack-chan's face will invert.

## Debugging

You can start the selected host under the Moddable debugger with:

```
$ npm run debug
```

Use the board-specific debug scripts from the table above for Stack-chan RT or Takao Core2 + SG90.
These commands will open Moddable's debugger `xsbug` and connect it to the M5Stack.

On M5StackChan CoreS3 with Moddable SDK 9.0.0 or later, debug and instrument builds reserve the built-in
USB Serial/JTAG CDC driver for the Moddable debugger even when xsbug is not launched. Stackchan Dock and
Codex Voice cannot use that CDC connection in the same build; use the normal release-mode `build`, `flash`,
or `deploy` command when testing USB communication.

![xsbug](./images/xsbug.png)

Using `xsbug`, you can check logs, set breakpoints (temporarily pause the program at specific lines), and perform step-by-step execution.
For detailed instructions on how to use `xsbug`, please refer to the [official documentation](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/xs/xsbug.md).

Use the terminal-based `xsdb` debugger with:

```console
$ npm run debug:xsdb
```

When more than one serial device is connected, select one explicitly:

```console
$ npm run debug:xsdb -- --port /dev/ttyACM1
```

## (Optional) Writing user application (mods)

The following command is used to build and write a mod.

_No `sudo` required for the command._

```console
$ npm run mod -- [mod manifest file path]
```

`npm run mod` first creates an XS archive with `mcrun -t build`. It then uses `esptool` to read the live
partition table and writes the archive directly to the type `0x40`, subtype `1` `xs` partition. The command
discovers the offset from the device and validates the archive format, partition capacity, selected chip,
Moddable firmware descriptor, and written bytes. It does not use the xsbug install channel, so either a debug
or release host can load the MOD.

Use `--port` or `STACKCHAN_PORT` when more than one serial device is connected:

```console
$ npm run mod -- ./mods/examples/look_around/manifest.json --port /dev/ttyACM1
```

The standard command accepts MOD manifests that resolve to JavaScript modules.
ESP32 and lin targets can also use TypeScript modules through the Moddable toolchain.
For the WASM host, build the MOD with a TypeScript-capable target such as `lin`, then load the generated `.xsb` or archive.

After installation, the MOD runs instead of the product default behavior.
The exact button and screen behavior depends on the installed MOD.

**Example: Installing [`mods/examples/look_around`](../mods/examples/look_around/)**

```console
$ npm run mod -- ./mods/examples/look_around/manifest.json

> stack-chan@0.2.1 mod
> node scripts/firmware.mjs mod ./mods/examples/look_around/manifest.json

# xsc mod.xsb
# xsc check.xsb
# xsc mod/config.xsb
# xsl look_around.xsa
[stack-chan] MOD preflight: xs_esp32 9.0.0+stackchan.1, XS 17.8.0, xs=0xfa0000/262144
[stack-chan] MOD installed and verified: .../look_around.xsa
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
