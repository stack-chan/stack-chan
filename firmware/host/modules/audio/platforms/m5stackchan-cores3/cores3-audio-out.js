import AudioOut from 'stackchanCores3AudioOutNative'
import { cores3I2SBus } from 'cores3I2SBus'

export default class CoreS3AudioOut extends AudioOut {
  constructor(options) {
    cores3I2SBus.acquire('speaker', options?.sampleRate)
    try {
      super(options)
    } catch (error) {
      cores3I2SBus.release('speaker')
      throw error
    }
    cores3I2SBus.acquire('speaker', this.sampleRate)
  }

  start() {
    cores3I2SBus.acquire('speaker', this.sampleRate)
    return super.start()
  }

  stop() {
    const result = super.stop()
    cores3I2SBus.release('speaker')
    return result
  }

  close() {
    try {
      return super.close()
    } finally {
      cores3I2SBus.release('speaker')
    }
  }
}
