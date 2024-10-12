import AudioIn from 'pins/audioin'
import Timer from 'timer'

export default class Microphone {
  recording: boolean

  constructor() {
    this.recording = false
  }

  async record(durationSec = 3): Promise<ArrayBuffer> {
    if (this.recording) {
      throw new Error('already recording')
    }
    this.recording = true

    const audio = new AudioIn()
    const { sampleRate, numChannels, bitsPerSample } = audio
    const byteRate = sampleRate * numChannels * (bitsPerSample >> 3)
    const contentLength = durationSec * byteRate
    const view = new DataView(new ArrayBuffer(44 + contentLength))

    // set header
    view.setUint8(0, 'R'.charCodeAt(0))
    view.setUint8(1, 'I'.charCodeAt(0))
    view.setUint8(2, 'F'.charCodeAt(0))
    view.setUint8(3, 'F'.charCodeAt(0))
    view.setUint32(4, 36 + contentLength, true)
    view.setUint8(8, 'W'.charCodeAt(0))
    view.setUint8(9, 'A'.charCodeAt(0))
    view.setUint8(10, 'V'.charCodeAt(0))
    view.setUint8(11, 'E'.charCodeAt(0))
    view.setUint8(12, 'f'.charCodeAt(0))
    view.setUint8(13, 'm'.charCodeAt(0))
    view.setUint8(14, 't'.charCodeAt(0))
    view.setUint8(15, ' '.charCodeAt(0))
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, (1 * bitsPerSample) >> 3, true)
    view.setUint16(34, bitsPerSample, true)
    view.setUint8(36, 'd'.charCodeAt(0))
    view.setUint8(37, 'a'.charCodeAt(0))
    view.setUint8(38, 't'.charCodeAt(0))
    view.setUint8(39, 'a'.charCodeAt(0))
    view.setUint32(40, contentLength, true)

    const recordSamples = async (durationSec): Promise<void> => {
      const readingsPerSecond = 8
      const sampleCount = Math.floor(audio.sampleRate / readingsPerSecond)
      let samplesRemaining = durationSec * audio.sampleRate

      return new Promise((resolve) => {
        let offset = 44
        Timer.repeat((id) => {
          const samples = new Int16Array(audio.read(sampleCount))
          for (let i = 0; i < samples.length; i++) {
            view.setInt16(offset, samples[i], true)
            offset += 2
          }

          samplesRemaining -= sampleCount
          trace(`${samplesRemaining}\n`)
          if (samplesRemaining <= 0) {
            Timer.clear(id)
            resolve()
          }
        }, 1000 / readingsPerSecond)
      })
    }

    await recordSamples(durationSec)

    this.recording = false
    audio.close()
    return view.buffer
  }
}
