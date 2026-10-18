# Built-in RFID sample (M5StackChan CoreS3)

Requires a host rebuilt with Moddable SDK **10.0.1** and this platform change.
The host exposes the official `embedded:sensor/RFID/ST25R3916` driver as
`device.sensor.RFID`. It does not instantiate the reader or start background
polling. Other boards are not given a built-in RFID provider.

From `firmware/`:

```sh
npm run build:m5stackchan_cores3 -- --mode=debug
npm run deploy:m5stackchan_cores3 -- --mode=debug
npm run mod -- mods/examples/rfid/manifest.json
```

Open the drawer:

1. **RFID polling** starts at **OFF** (no reader instance). Select **250 ms**
   or **1000 ms** to create one reader and enable its antenna.
2. Present an ISO14443 Type A tag. Its UID appears in the balloon; the debugger
   log also includes SAK and the driver's type name. Holding the same tag does
   not repeatedly emit detection. Removing it emits `card removed`.
3. **Read NDEF** reads a currently present Type 2 tag. The full decoded records
   appear in the debugger log, and a URI/text or an empty/unavailable result
   appears in the balloon.
4. On a disposable, writable, NDEF-formatted NTAG/Ultralight, **Write test URI**
   overwrites its NDEF with `https://stack-chan.com/`, then reads it back in a
   separate call and checks the URI. Keep the same tag in place until completion.
   It writes only when pressed, never during polling.
5. Select **OFF** to clear the polling timer, turn the antenna off and close the
   reader. Re-enabling creates a fresh reader so the same UID can be detected
   again. Repeated `onContextCreated` calls clean up the previous reader/timer
   and drawer entries. Normal MOD switching restarts the firmware.

The SDK supports Type A UID detection and Type 2 NDEF IO. MIFARE Classic sector
IO/Crypto1 is not implemented. Type 2 tags must already have an `E1` Capability
Container on page 3; this sample does not format tags, unlock them, or alter lock
bytes/CC. Locked tags, insufficient capacity, removing a tag during IO and
read-back mismatches are reported as failures. A failed write may be partial.

## Internal I2C and timing

The provider fixes SMBus to `device.i2c.internal`: SDA G12, SCL G11, port 1,
400 kHz, address `0x50`. It preserves top-level driver options (such as `target`)
and does not allow `sensor` overrides to reroute the built-in chip. It uses no
IRQ GPIO and creates no separate bus controller. Touch, Si12T (`0x68`), IMU
(`0x69`) and PY32 (`0x6F`) retain their existing providers and bus settings.
RFID `close()` closes its own addressed SMBus instance, not those peripherals.

Polling and NDEF calls are synchronous. Timer callbacks cannot interleave NDEF
IO on the JS event loop, but the SDK's register polling and `Timer.delay()` can
delay touch processing, animation, IMU and PY32 operations. Start at 250 ms,
compare 1000 ms under load, and stop when unused. A period is a scheduling target,
not a guaranteed detection latency. This sample does not automatically read NDEF
on every scan, to keep normal polling lighter.

In SDK 10.0.1, `sample()` returns an edge or `undefined`; it also suppresses
internal exceptions. `undefined` is therefore not proof of healthy RF/I2C IO.
The driver can re-enable its RF field after repeated misses even when configured
OFF, so this sample never samples or performs NDEF IO while stopped and closes
the reader. Constructor initialization briefly enables the field; OFF at startup
is achieved by not constructing it at all.

## Verification

Software checks from `firmware/` (set `MODDABLE` to SDK 10.0.1):

```sh
npm run test:providers
npm run test:rfid
npm run test:unit
npm run mod:build -- mods/examples/rfid/manifest.json
```

Provider and sample tests use simulated peripherals/timers; they do not prove
RF transactions or shared-bus performance. Physical acceptance remains:

- Read 4/7/10-byte Type A UIDs as available, hold/remove/re-present a tag, and
  change tags at both polling periods. Measure missed events and latency.
- Read an existing Type 2 text/URI, empty NDEF and an unsupported Type A card;
  write/read back the test URI on a writable tag and confirm with a phone or
  independent reader. Check locked, too-small and interrupted writes.
- Confirm antenna OFF after stopping, no polls while stopped, fresh detection
  after restarting, and no leaked reader/timer across restart/MOD switching.
- Exercise display/top touch, IMU, PY32 head LEDs and servo power while polling
  and writing. Compare UI/servo responsiveness with RFID OFF, 250 and 1000 ms;
  inspect I2C/NACK/reset behavior. Keep other peripheral instances usable after
  stopping RFID.
