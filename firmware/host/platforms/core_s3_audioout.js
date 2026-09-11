import AudioOutOriginal, { Mixer } from 'pins/audioout-original'

// Include manifest_core_s3_audioout.json before audio streamer manifests:
// Moddable keeps the first mapping for each source and module name.
export { Mixer }

export default class CoreS3AudioOut extends AudioOutOriginal {
  constructor(options) {
    super(options)
    if (globalThis.amp) {
      globalThis.amp.sampleRate = this.sampleRate
    }
  }
}
