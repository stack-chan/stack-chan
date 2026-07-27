import Timer from 'timer'

const Command = Object.freeze({
  break: 0x3093,
  measureHighRepeatabilityWithClockStretching: 0x2c06,
  softReset: 0x30a2,
})

function crc8(buffer, offset) {
  let crc = 0xff
  for (let index = offset; index < offset + 2; index += 1) {
    crc ^= buffer[index]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff
    }
  }
  return crc
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

class SHT3x {
  #errorTimer
  #io
  #onError
  #state = 'closed'
  #valueBuffer = new Uint8Array(6)
  #wordBuffer = new Uint8Array(2)

  constructor(options) {
    if (!isObject(options)) throw new TypeError('options must be an object')

    const sensor = options.sensor
    if (!isObject(sensor)) throw new TypeError('sensor must be an object')

    const { io: IO, ...connection } = sensor
    if (typeof IO !== 'function') throw new TypeError('sensor.io must be a constructor')

    const onError = options.onError ?? null
    if (onError !== null && typeof onError !== 'function') throw new TypeError('onError must be a function or null')

    this.#onError = onError
    const target = options.target
    if (target !== undefined) this.target = target

    let io
    try {
      io = new IO({
        hz: 1_000_000,
        address: 0x44,
        ...connection,
      })
      this.#io = io

      // A previous client may have left the sensor in periodic acquisition mode.
      // BREAK is harmless when accepted and a following soft reset verifies that
      // the device is responsive even when BREAK itself is NACKed while idle.
      try {
        this.#writeCommand(Command.break)
        Timer.delay(1)
      } catch {
        // Continue with soft reset. A persistent bus error fails below and is
        // handled by the constructor cleanup path.
      }

      this.#writeCommand(Command.softReset)
      Timer.delay(2)
      this.#state = 'open'
    } catch (error) {
      this.#io = undefined
      try {
        io?.close()
      } catch {
        // Preserve the construction failure that triggered cleanup.
      }
      throw error
    }
  }

  configure(options) {
    this.#assertUsable()
    if (!isObject(options)) throw new TypeError('options must be an object')
  }

  close() {
    if (this.#state === 'closed') return

    this.#state = 'closed'
    if (this.#errorTimer !== undefined) {
      Timer.clear(this.#errorTimer)
      this.#errorTimer = undefined
    }

    const io = this.#io
    this.#io = undefined
    io?.close()
  }

  sample() {
    this.#assertUsable()

    const buffer = this.#valueBuffer
    try {
      this.#writeCommand(Command.measureHighRepeatabilityWithClockStretching)
      this.#io.read(buffer)
    } catch (error) {
      this.#fail()
      throw error
    }

    if (buffer[2] !== crc8(buffer, 0) || buffer[5] !== crc8(buffer, 3)) return undefined

    const rawTemperature = (buffer[0] << 8) | buffer[1]
    const rawHumidity = (buffer[3] << 8) | buffer[4]
    return {
      hygrometer: {
        humidity: rawHumidity / 65_535,
      },
      thermometer: {
        temperature: (rawTemperature * 175) / 65_535 - 45,
      },
    }
  }

  #assertUsable() {
    if (this.#state === 'closed') throw new Error('sensor is closed')
    if (this.#state === 'failed') throw new Error('sensor has failed')
  }

  #fail() {
    if (this.#state !== 'open') return
    this.#state = 'failed'

    const onError = this.#onError
    if (onError === null) return
    try {
      this.#errorTimer = Timer.set(() => {
        this.#errorTimer = undefined
        if (this.#state === 'failed') onError.call(this)
      }, 0)
    } catch {
      // Do not replace the I/O exception with a callback scheduling failure.
    }
  }

  #writeCommand(command) {
    const buffer = this.#wordBuffer
    buffer[0] = command >> 8
    buffer[1] = command & 0xff
    this.#io.write(buffer)
  }

  static {
    SHT3x.prototype[Symbol.dispose] = SHT3x.prototype.close
  }
}

export default SHT3x
