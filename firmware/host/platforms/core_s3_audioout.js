import AudioOutOriginal, { Mixer } from 'pins/audioout-original'

export { Mixer }

export default class CoreS3AudioOut extends AudioOutOriginal {
  constructor(options) {
    super(options)
    if (globalThis.amp) {
      globalThis.amp.sampleRate = this.sampleRate
    }
  }
}
