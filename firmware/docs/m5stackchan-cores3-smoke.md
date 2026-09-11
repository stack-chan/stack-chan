# M5StackChan CoreS3 smoke check

This smoke check exercises the current M5StackChan CoreS3 servo-power and 12 RGB LED paths with the shared SDK board diagnostics MOD (host API 5 or later). It is intended for manual hardware validation and does not require secrets or network configuration.

Keep `host/app/manifest_local.json` free of private bench configuration. The checked-in file intentionally contains an empty `"config"` object; add local driver, Wi-Fi, or TTS settings only in your working copy.

Related tracking issues: #406, #408, #409, #412.

## Build the host

Run these commands from `firmware/`.

```console
$ npm run build:m5stackchan_cores3
```

To flash the host when hardware is connected:

```console
$ npm run flash:m5stackchan_cores3
```

## Install the smoke MOD

```console
$ npm run mod:m5stackchan_cores3 -- ./mods/examples/board_diagnostics/manifest.json
```

## Expected smoke sequence

The app starts the check one second after setup. In `xsbug`, verify these phases:

1. `[board diagnostics] start`.
2. The servos move to neutral, then yaw +4.58° / pitch −3.44°, and back to neutral. Each target is clamped to the configured limits. The motion service enables torque as part of preparation and waits for release after the sequence.
3. `[board diagnostics] servo: native`.
4. The `head` LEDs turn red, blink green with a complete on/off cycle of 250 ms, show a rainbow, then turn off.
5. `[board diagnostics] LED: head` and `[board diagnostics] complete`.

A servo failure does not skip the independent LED check. Missing or failed hardware produces `[board diagnostics] error: ...` and an on-screen message, never `complete`. `simulated` is distinct from a hardware pass. Completion confirms the command sequence; inspect the physical movement, torque release and LEDs as part of manual acceptance.

The same app includes a **ボード診断** menu action to repeat the check and **LED** selection for other configured lights. A changes red/green/blue, B turns the selected LEDs off, and C selects the rainbow effect. The menu exposes the same operations and blinking. Manual LED operations are ignored during the automated sequence. Closing the app cancels its tasks and turns off every LED it used.

The servo motion is intentionally small. Keep the device clear of obstructions before running the check. The LED names and PY32 wiring come from `host/platforms/m5stackchan_cores3/manifest.json`.

## Automated runner

`scripts/run-device-smoke.js` automates the install-and-verify loop: it builds and installs the archive through the normal `firmware mod` command, including live host API / XS / partition checks and read-back verification. It then attaches `serial2xsbug` to the same port and collects device traces through a local xsbug log server, and passes when `[board diagnostics] complete` appears without a failure marker. Failure takes priority if both appear in the collected log.

```console
$ UPLOAD_PORT=/dev/ttyACM0 npm run test:device
```

The xsbug channel requires a debug host build. Add `--flash` to build and install it before the MOD.

Options and environment:

- `--device <name>` / `STACKCHAN_DEVICE` — target device (default `m5stackchan_cores3`)
- `--port <path>` / `STACKCHAN_PORT` / `UPLOAD_PORT` / `ESPPORT` — required; the same port is used for preflight, installation and tracing
- `--flash` — build and deploy the host firmware before installing the MOD
- `--mod <manifest>` — smoke MOD manifest (default `mods/examples/board_diagnostics/manifest.json`)
- `STACKCHAN_DEVICE_SMOKE_TIMEOUT_MS` — per-attempt timeout (default 120000)
- `STACKCHAN_DEVICE_SMOKE_RETRIES` — retries on channel drop (default 2); retries restart the debugger bridge, without rebuilding or rewriting the archive
- `DEBUGGER_SPEED` — debugger serial baud rate (default 460800)
- `STACKCHAN_DRY_RUN=1` — show the firmware commands without writing or testing a device

The xsbug serial bridge is known to be unstable on CoreS3, so timed-out attempts retry automatically. `--channel serial` falls back to watching the raw serial console for crash markers only — `trace()` output is not visible on raw serial (it only flows over the xsbug protocol in debug builds), so serial mode verifies boot stability, not smoke completion.

If installation or live-device preflight fails, the runner stops before starting diagnostics. Each bridge is terminated before a retry begins. CLI process tests cover ordering, rejected installation, retry, device failure and termination, but physical USB reset, servo and LED behavior still require the hardware check above.
