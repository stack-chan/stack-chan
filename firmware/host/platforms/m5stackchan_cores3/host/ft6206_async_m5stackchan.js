/*
 * M5Stack CoreS3 FT6x06 touch driver variant for Stack-chan.
 *
 * This keeps the ECMA-419 async shape used by Moddable's FT6206 driver, but
 * uses polling instead of a GPIO edge callback. M5GFX treats CoreS3 GPIO21 as a
 * level hint, not as the event source; the touch controller is configured for
 * polling mode and sampled over I2C.
 */

import config from 'mc/config'
import Timer from 'timer'

const ADDRESS = 0x38
const REG_TOUCHES = 0x02
const REG_THRESHOLD = 0x80
const REG_CTRL = 0x86
const REG_TIMEOUT = 0x87
const REG_INT_MODE = 0xa4
const REG_CHIP_ID = 0xa3
const REG_VENDOR_ID = 0xa8

const idleIntervalMs = config.touchIdleIntervalMs ?? 50
const activeIntervalMs = config.touchActiveIntervalMs ?? 8
const releaseDebounceMs = config.touchReleaseDebounceMs ?? 75

class FT6206 {
  #io
  #onError
  #onSample
  #releaseTimer
  #timer

  constructor(options) {
    const { sensor, reset, onSample, target, onError } = options
    const io = new sensor.io.Async({
      hz: 400_000,
      address: ADDRESS,
      ...sensor,
    })
    this.#io = io
    this.#onError = onError
    this.#onSample = onSample
    io.buffer = new Uint8Array(13)
    io.configure = {
      active: false,
      threshold: 20,
      timeout: 10,
    }
    io.activeTouch = false

    if (target) this.target = target

    const check = () => {
      this.#timer = undefined
      io.readUint8(REG_VENDOR_ID, (error, vendor) => {
        if (error) {
          this.#onError?.(error)
          return
        }
        if (vendor !== 17 && vendor !== 1 && vendor !== 2 && vendor !== 0) {
          this.#onError?.('unexpected vendor')
          return
        }
        io.readUint8(REG_CHIP_ID, (error, id) => {
          if (error) {
            this.#onError?.(error)
            return
          }
          if (id !== 6 && id !== 100) {
            this.#onError?.('unexpected chip')
            return
          }

          const pending = io.configure
          const timeout = pending.timeout
          delete pending.timeout
          delete io.configure
          this.configure(pending)
          io.writeUint8(REG_TIMEOUT, timeout, () => {
            io.writeUint8(REG_INT_MODE, 0x00, () => {
              trace(
                `[m5stackchan-cores3] Touch polling ready idle=${idleIntervalMs}ms active=${activeIntervalMs}ms releaseDebounce=${releaseDebounceMs}ms\n`,
              )
              this.#timer = Timer.set(() => this.#doSample(), 0, idleIntervalMs)
            })
          })
        })
      })
    }

    if (reset) {
      io.reset = new reset.io({
        ...reset,
        initialValue: 0,
      })

      Timer.delay(5)
      io.reset.write(1)
      this.#timer = Timer.set(check, 150)
    } else {
      check()
    }
  }

  close(callback) {
    this.#io?.reset?.close()
    this.#io?.close((error) => callback?.(error))
    this.#io = undefined
    if (this.#releaseTimer) {
      Timer.clear(this.#releaseTimer)
      this.#releaseTimer = undefined
    }
    if (this.#timer) {
      Timer.clear(this.#timer)
      this.#timer = undefined
    }
  }

  configure(options) {
    const io = this.#io
    if (io.configure) {
      io.configure = { ...io.configure, ...options }
      return
    }

    if ('threshold' in options) io.writeUint8(REG_THRESHOLD, options.threshold)
    if ('active' in options) io.writeUint8(REG_CTRL, options.active ? 0 : 1)
    if ('timeout' in options) io.writeUint8(REG_TIMEOUT, options.timeout)

    let value = options.flip
    if (value) {
      delete io.flipX
      delete io.flipY

      if (value === 'h') io.flipX = true
      else if (value === 'v') io.flipY = true
      else if (value === 'hv') io.flipX = io.flipY = true
    }

    value = options.length
    if (value !== undefined) io.length = value === 1 ? 1 : 2

    if ('weight' in options) {
      delete io.weight
      if (options.weight) io.weight = true
    }

    if ('area' in options) {
      delete io.area
      if (options.area) io.area = true
    }
  }

  sample() {
    const result = this.#io.sample
    delete this.#io.sample
    return result
  }

  #emitRelease() {
    const io = this.#io
    this.#releaseTimer = undefined
    io.activeTouch = false
    if (io.none) return
    io.none = true
    io.sample = []
    this.#onSample?.()
  }

  #scheduleRelease() {
    const io = this.#io
    if (!io.activeTouch) {
      if (io.none) return
      io.none = true
      io.sample = []
      this.#onSample?.()
      return
    }
    if (this.#releaseTimer) return
    this.#releaseTimer = Timer.set(() => this.#emitRelease(), releaseDebounceMs)
  }

  #clearPendingRelease() {
    if (!this.#releaseTimer) return
    Timer.clear(this.#releaseTimer)
    this.#releaseTimer = undefined
  }

  #onData(error) {
    const io = this.#io
    if (error) {
      this.#onError?.(error)
      if (this.#timer) Timer.schedule(this.#timer, idleIntervalMs, idleIntervalMs)
      return
    }

    const data = io.buffer
    const length = Math.min(data[0] & 0x0f, io.length ?? 2)
    if (length === 0) {
      if (this.#timer) Timer.schedule(this.#timer, idleIntervalMs, idleIntervalMs)
      this.#scheduleRelease()
      return
    }

    this.#clearPendingRelease()
    delete io.none
    io.activeTouch = true

    const result = new Array(length)
    for (let i = 0; i < length; i++) {
      const offset = 1 + i * 6
      const id = data[offset + 2] >> 4
      let x = ((data[offset] & 0x0f) << 8) | data[offset + 1]
      let y = ((data[offset + 2] & 0x0f) << 8) | data[offset + 3]

      if (io.flipX) x = 240 - x
      if (io.flipY) y = 320 - y

      const point = { x, y, id }
      if (io.weight) point.weight = data[offset + 4]
      if (io.area) point.area = data[offset + 5] >> 4

      if (io.length === 1) {
        point.id = 0
        result[0] = point
        break
      }
      result[i] = point
    }

    io.sample = result
    if (this.#timer) Timer.schedule(this.#timer, activeIntervalMs, activeIntervalMs)
    this.#onSample?.()
  }

  #doSample() {
    if (this.#timer) Timer.schedule(this.#timer)
    this.#io.readBuffer(REG_TOUCHES, this.#io.buffer, (error) => this.#onData(error))
  }

  get configuration() {
    return {
      interrupt: true,
    }
  }
}

export default FT6206
