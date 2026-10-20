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
