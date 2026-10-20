// Select this manifest before manifest_base: the SDK typings insert a pins/* key
// reused by streamers, and first JS source wins. Register the original first.
import AudioOutOriginal, { Mixer } from 'pins/audioout-original'

export { Mixer }

export default class CoreS3AudioOut extends AudioOutOriginal {
  constructor(options) {
    super(options)
    try {
      if (globalThis.amp) {
        globalThis.amp.sampleRate = this.sampleRate
      }
    } catch (error) {
      // A failed codec write must not retain I2S and block the next playback
      // or native conversation until garbage collection.
      super.close()
      throw error
    }
  }
}
