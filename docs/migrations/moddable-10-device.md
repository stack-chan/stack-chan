# Moddable 10 device providers

Stack-chan uses the SDK's Core2/CoreS3 provider as its board definition. The three
custom targets extend that definition only where their hardware differs:

- M5StackChan CoreS3: internal I2C port 1 for camera SCCB reuse, polling touch at
  400 kHz, and the Si12T head touch panel.
- Stackchan RT: internal I2C port 1 for camera SCCB reuse. Servo UART pins stay in
  the target's driver configuration.
- Takao Core2 SG90: the SDK Core2 provider; servo PWM pins stay in the target's
  driver configuration. SDK touch, IMU, RTC, power and backlight remain available.

Individual SDK IO manifests preload `config/<io>` and populate `device.io`.
The host retains digital, I2C/SMBus, PWM and serial IO. Camera and USB audio do not
need the all-IO manifest. Analog, SPI, pulse-count and pulse-width IO are omitted
because the shipped host and MODs do not use them; native display and SD drivers
do not use the JavaScript SPI class. DigitalBank remains with the SDK digital
manifest. The upstream ChatAudioIO manifest also includes all IO. The application
uses the SDK's `modules["~"]` exclusion to remove the unused class, config and
native sources without copying that SDK manifest. Its IDF dependencies may still
be present in the flattened manifest; unused JS/native IO implementations are
excluded from the actual link module list. All servo protocols are retained for configurable boards.

Use lowercase `device.i2c` and `device.serial` and the standard `device.rtc`
options object. The SDK currently supplies deprecated uppercase aliases for
old MODs. New MODs should use the lowercase names. A MOD that needs an omitted
native IO class needs a host built with that SDK IO manifest: an archive cannot
add a missing native class to an already running host.

Provider companion typings augment the SDK's `DeviceI2C` and `DeviceSerial`
interfaces instead of describing independent constructor and option types.

Run `npm run test:providers` with `MODDABLE` set to SDK 10. It evaluates both the
real SDK and Stack-chan provider/config/lockdown code with hardware constructors
stubbed, checking resolved buses, polling touch, camera bus sharing, RTC, IMU,
power and backlight. This is a wiring regression test, not proof of physical
device behavior. Build all six `build:release:<target>` scripts and inspect
generated `manifest_flat.json` and makefile module lists. Physical acceptance
still covers touch/rotation, camera, audio/USB, servos, rail power and SD access.

Release impact: minor. Native IO available to custom MODs is reduced, while all
shipped board features and examples remain included. Do not replace the 9.5
release before validating physical devices.
