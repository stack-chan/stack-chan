import AudioIn from 'stackchanCores3AudioInNative'
import { cores3I2SBus } from 'cores3I2SBus'

export default class CoreS3AudioIn extends AudioIn {
  constructor(options) {
    cores3I2SBus.acquire('microphone', options?.sampleRate)
    try {
      super(options)
    } catch (error) {
      cores3I2SBus.release('microphone')
      throw error
    }
  }

  start() {
    cores3I2SBus.acquire('microphone', this.sampleRate)
    return super.start()
  }

  stop() {
    const result = super.stop()
    cores3I2SBus.release('microphone')
    return result
  }

  close() {
    try {
      return super.close()
    } finally {
      cores3I2SBus.release('microphone')
    }
  }
}
