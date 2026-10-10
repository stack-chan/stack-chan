# Moddable 10 device providers

Stack-chan uses the SDK's Core2/CoreS3 provider as its board definition. The three
custom targets extend that definition only where their hardware differs:

- M5StackChan CoreS3: internal I2C port 1 for camera SCCB reuse, polling touch at
  400 kHz, and the Si12T head touch panel.
- Stackchan RT: internal I2C port 1 for camera SCCB reuse. Servo UART pins stay in
  the target's driver configuration.
- Takao Core2 SG90: the SDK Core2 provider; servo PWM pins stay in the target's
  driver configuration. SDK touch, IMU, RTC, power and backlight are available.

Individual SDK IO manifests preload `config/<io>` and populate `device.io`.
The host retains Analog, Digital/DigitalBank, I2C/SMBus, PulseCount, PulseWidth,
PWM, Serial and SPI, including their native implementations. The upstream
ChatAudioIO manifest includes all eight IO manifests. Camera and USB audio do
not need their own all-IO include, and the application does not exclude public
IO classes or config modules. Existing MODs can continue to import these native
IO classes from the host. Native display and SD drivers also retain their
separate `pins/spi` implementation. All servo protocols remain included.

Use lowercase `device.analog`, `device.i2c`, `device.serial` and `device.spi`,
and the standard `device.rtc` options object. The SDK's deprecated `Analog`,
`I2C`, `Serial` and `SPI` aliases refer to the same bus objects, and its legacy
`device.peripheral.RTC` constructor remains available. New MODs should use the
standard names.

The SDK provider also exposes Backlight on RT and touch, IMU, RTC and backlight
on Takao, which their previous local providers did not expose. Physical behavior
and RAM/heap changes still require validation; this migration does not claim a
memory reduction.

Provider companion typings augment the SDK's `DeviceI2C` and `DeviceSerial`
interfaces instead of describing independent constructor and option types.

Run `npm run test:providers` with `MODDABLE` set to SDK 10. It evaluates both the
real SDK and Stack-chan provider/config/lockdown code with hardware constructors
stubbed, checking resolved buses, polling touch, camera bus sharing, RTC, IMU,
power, backlight, public IO classes and legacy aliases. This is a wiring
regression test, not proof of physical device behavior. Build all six `build:release:<target>` scripts and inspect
generated `manifest_flat.json` and makefile module lists. Physical acceptance
still covers touch/rotation, camera, audio/USB, servos, rail power and SD access.

Release impact: minor. Public native IO remains available to custom MODs, and
shipped board features and examples remain included. Do not replace the 9.5
release before validating physical devices.
