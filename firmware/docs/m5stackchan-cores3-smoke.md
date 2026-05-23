# M5StackChan CoreS3 smoke check

This smoke check exercises the current M5StackChan CoreS3 servo-power and 12 RGB LED paths with a small MOD. It is intended for manual hardware validation and does not require secrets or network configuration.

Related tracking issues: #406, #408, #409, #412.

## Build the host

Run these commands from `firmware/`.

```console
$ mcconfig -d -m -p esp32:./platforms/m5stackchan_cores3 -t build "$PWD/stackchan/manifest_m5stackchan_cores3.json"
```

To flash the host when hardware is connected:

```console
$ mcconfig -d -m -p esp32:./platforms/m5stackchan_cores3 -t deploy "$PWD/stackchan/manifest_m5stackchan_cores3.json"
```

## Install the smoke MOD

```console
$ npm run mod --target=esp32:./platforms/m5stackchan_cores3 ./mods/m5stackchan_smoke/manifest.json
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

The servo motion is intentionally small. Keep the device clear of obstructions before running the check. The LED names and PY32 wiring come from `platforms/m5stackchan_cores3/manifest.json`.
