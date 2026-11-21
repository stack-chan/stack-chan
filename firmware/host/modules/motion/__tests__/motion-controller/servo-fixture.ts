import Timer from 'timer'

export const servoFixture = {
  powerEnabled: false,
  wireDisconnected: false,
  faultOnNextPowerWrite: false,
  yaw: undefined as Uint8Array | undefined,
  tilt: undefined as Uint8Array | undefined,
  yawPositionWrites: 0,
  poweredModeRestores: 0,
}

export default class Serial {
  format: string
  #onReadable: (this: Serial, length: number) => void
  #received: number[] = []

  constructor({ format, onReadable }) {
    this.format = format
    this.#onReadable = onReadable
    const yaw = new Uint8Array(64)
    yaw.set([0, 15, 3, 132], 9)
    yaw.set([0x02, 0xdb], 56)
    yaw[40] = 1
    servoFixture.yaw = yaw
    servoFixture.tilt = new Uint8Array(64)
  }

  write(data: Uint8Array) {
    if (!servoFixture.powerEnabled || servoFixture.wireDisconnected) return
    const id = data[2]
    const yaw = servoFixture.yaw
    const registers = id === 1 ? yaw : servoFixture.tilt
    const command = data[4]
    const address = data[5]
    const values = data.subarray(6, data.length - 1)
    let status = 0
    if (command === 3) {
      if (registers === yaw) {
        if (address === 9 && (values[2] || values[3]) && yaw[40]) servoFixture.poweredModeRestores += 1
        if (address === 42) servoFixture.yawPositionWrites += 1
        if (address === 44 && (values[0] || values[1]) && servoFixture.faultOnNextPowerWrite) {
          servoFixture.faultOnNextPowerWrite = false
          status = 0x20
        }
      }
      registers.set(values, address)
    }
    const payload = command === 2 ? registers.subarray(address, address + values[0]) : []
    const response = [0xff, 0xff, id, payload.length + 2, status, ...payload]
    const checksum = ~response.slice(2).reduce((sum, byte) => sum + byte, 0) & 0xff
    response.push(checksum)
    Timer.set(() => {
      this.#received.push(...response)
      this.#onReadable.call(this, response.length)
    }, 0)
  }

  read(): number {
    return this.#received.shift()
  }
}

export function tryGetSharedPY32IOExpander() {
  return {
    setDirection() {},
    setPullMode() {},
    digitalWrite(_pin: number, enabled: boolean) {
      servoFixture.powerEnabled = enabled
    },
    getWriteValue() {
      return servoFixture.powerEnabled
    },
  }
}
