// Board-specific additions to the SDK's manifest-composed device interfaces.
declare module 'embedded:provider/builtin' {
  import type RTC from 'embedded:RTC'
  import type { RTCOptions } from 'embedded:RTC'
  import type { PinSpecifier } from 'embedded:io/_common'

  interface Device {
    pin: DevicePin
    network: DeviceNetwork
    rtc: RTCOptions & { io: typeof RTC }
  }
  interface DevicePin {
    displayDC: PinSpecifier
    displaySelect: PinSpecifier
  }
  interface DeviceI2C {
    default: I2CBus
    internal: I2CBus
  }
  interface DeviceSerial {
    default: SerialBus
  }
}
