/*
 * Copyright (c) 2023 Shinya Ishikawa
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

import Touch from 'M5StackCoreS3Touch'
import TouchPanel from 'embedded:sensor/Touch/Si12T'
import device from 'sdk-board-provider'

// Camera SCCB reuses the initialized internal bus on port 1.
device.i2c.internal.port = 1
device.rtc.clock.port = 1

// Keep Chan's polling configuration; the SDK supplies buses, IMU, RTC and backlight.
device.sensor.Touch = class {
  constructor(options) {
    trace('[m5stackchan-cores3] Touch provider init hz=400000 polling\n')
    const result = new Touch({
      ...options,
      sensor: { ...device.i2c.internal, io: device.io.SMBus, hz: 400_000 },
    })
    result.configure({ threshold: 20, active: false, timeout: 10 })
    // biome-ignore lint/correctness/noConstructorReturn: Moddable providers return peripheral instances.
    return result
  }
}

device.sensor.TouchPanel = class {
  constructor(options) {
    trace(
      `[m5stackchan-cores3] TouchPanel provider init channels=${options?.channels ?? 3} sensitivityLevel=${options?.sensitivityLevel ?? 3}\n`,
    )
    // biome-ignore lint/correctness/noConstructorReturn: Moddable providers return peripheral instances.
    return new TouchPanel({
      ...options,
      sensor: { ...device.i2c.internal, io: device.io.SMBus },
    })
  }
}

export default device
