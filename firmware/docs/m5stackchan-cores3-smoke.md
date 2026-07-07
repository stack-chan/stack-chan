# M5StackChan CoreS3 smoke check

This smoke check exercises the current M5StackChan CoreS3 servo-power and 12 RGB LED paths with a small MOD. It is intended for manual hardware validation and does not require secrets or network configuration.

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
$ npm run mod:m5stackchan_cores3 -- ./mods/examples/m5stackchan_smoke/manifest.json
```

## Expected smoke sequence

Open `xsbug` or serial logs and verify these log prefixes:

- `[M5StackChan CoreS3 smoke] start`
- `[M5StackChan CoreS3 smoke] servo: torque on`
- `[M5StackChan CoreS3 smoke] servo: neutral pose`
- `[M5StackChan CoreS3 smoke] servo: small yaw/pitch check`
- `[M5StackChan CoreS3 smoke] servo: torque off`
- `[M5StackChan CoreS3 smoke] LED: lightOn red`
- `[M5StackChan CoreS3 smoke] LED: lightBlink green`
- `[M5StackChan CoreS3 smoke] LED: lightRainbow`
- `[M5StackChan CoreS3 smoke] LED: lightOff`
- `[M5StackChan CoreS3 smoke] complete`

The servo motion is intentionally small. Keep the device clear of obstructions before running the check. The LED names and PY32 wiring come from `host/platforms/m5stackchan_cores3/manifest.json`.
