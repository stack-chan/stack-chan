# SHT3x

`embedded:sensor/Humidity-Temperature/SHT3x` is an ECMA-419 Sensor Class Pattern driver for Sensirion SHT30, SHT31, and SHT35 devices.

The constructor follows the ECMA TR/109 hardware component specification and accepts an I2C constructor through `options.sensor.io`.

`sample()` returns a fresh compound sample with temperature in degrees Celsius and relative humidity normalized to the ECMA-419 range from `0` to `1`.

A sample with an invalid device CRC returns `undefined` and leaves the sensor usable for a later retry.

An I/O exception makes the instance unusable, rethrows the original exception, and queues `onError()` for a later event-loop turn.

The implementation uses only JavaScript and the injected I2C class; it does not depend on Moddable's native `crc` module.

References:

- [ECMA-419](https://419.ecma-international.org/)
- [ECMA TR/109 SHT3x class specification](https://github.com/EcmaTC53/spec/blob/master/docs/Hardware%20Components/sensors/Humidity-Temperature-Sensirion-SHT3x.md)
- [Sensirion SHT3x-DIS datasheet](https://sensirion.com/media/documents/213E6A3B/63A5A569/Datasheet_SHT3x_DIS.pdf)
