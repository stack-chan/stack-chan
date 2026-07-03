import { type OwnedAudioBuffer, ownAudioBuffer } from 'audio-buffer'
import AudioIn from 'audio-in'

export default class Microphone {
  recording: boolean
  #audioIn: AudioIn | null
  onReadable?: (this: AudioIn, byteLength: number, sampleCount?: number) => void

  constructor() {
    this.recording = false
    this.#audioIn = null
  }

  start() {
    if (this.recording) {
      throw new Error('already recording')
    }
    const self = this
    this.#audioIn = new AudioIn({
      onReadable(size, sampleCount) {
        if (self.onReadable) {
          self.onReadable.call(this, size, sampleCount)
        }
      },
    })
    this.#audioIn.start()
    this.recording = true
  }

  stop() {
    this.#audioIn?.close()
    this.#audioIn = null
    this.recording = false
  }

  async record(durationMilliSec = 3000): Promise<OwnedAudioBuffer> {
    if (this.recording) {
      throw new Error('already recording')
    }
    this.recording = true
    const HEADER_SIZE = 44

    return new Promise((resolve, reject) => {
      let writeOffset = 0
      let audioin: AudioIn | undefined
      // biome-ignore lint/style/useConst: AudioIn callback closes over the buffer before AudioIn exposes its format fields.
      let wavBuffer: ArrayBuffer
      // biome-ignore lint/style/useConst: AudioIn callback closes over the view before AudioIn exposes its format fields.
      let dataView: Uint8Array
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        audioin?.close()
        this.recording = false
        resolve(ownAudioBuffer(wavBuffer))
      }
      const fail = (error: unknown) => {
        if (finished) return
        finished = true
        audioin?.close()
        this.recording = false
        reject(error)
      }

      try {
        audioin = new AudioIn({
          onReadable(size) {
            const remaining = dataView.byteLength - writeOffset
            trace(`${remaining}\n`)
            const chunkSize = Math.min(size, remaining)
            const chunk = this.read(chunkSize)

            if (!chunk) {
              finish()
            } else {
              dataView.set(new Uint8Array(chunk), writeOffset)
              writeOffset += chunkSize
              if (writeOffset >= dataView.byteLength) {
                finish()
              }
            }
          },
        })
      } catch (error) {
        this.recording = false
        reject(error)
        return
      }

      // generate header
      const { sampleRate, channels, bitsPerSample } = audioin
      const byteRate = sampleRate * channels * (bitsPerSample >> 3)
      const contentLength = (durationMilliSec / 1000) * byteRate
      wavBuffer = new ArrayBuffer(HEADER_SIZE + contentLength)
      const headerView = new DataView(wavBuffer)
      dataView = new Uint8Array(wavBuffer, HEADER_SIZE)

      headerView.setUint8(0, 'R'.charCodeAt(0))
      headerView.setUint8(1, 'I'.charCodeAt(0))
      headerView.setUint8(2, 'F'.charCodeAt(0))
      headerView.setUint8(3, 'F'.charCodeAt(0))
      headerView.setUint32(4, 36 + contentLength, true)
      headerView.setUint8(8, 'W'.charCodeAt(0))
      headerView.setUint8(9, 'A'.charCodeAt(0))
      headerView.setUint8(10, 'V'.charCodeAt(0))
      headerView.setUint8(11, 'E'.charCodeAt(0))
      headerView.setUint8(12, 'f'.charCodeAt(0))
      headerView.setUint8(13, 'm'.charCodeAt(0))
      headerView.setUint8(14, 't'.charCodeAt(0))
      headerView.setUint8(15, ' '.charCodeAt(0))
      headerView.setUint32(16, 16, true)
      headerView.setUint16(20, 1, true) // AudioFormat = 1 (PCM)
      headerView.setUint16(22, channels, true)
      headerView.setUint32(24, sampleRate, true)
      headerView.setUint32(28, byteRate, true)
      headerView.setUint16(32, (channels * bitsPerSample) >> 3, true)
      headerView.setUint16(34, bitsPerSample, true)
      headerView.setUint8(36, 'd'.charCodeAt(0))
      headerView.setUint8(37, 'a'.charCodeAt(0))
      headerView.setUint8(38, 't'.charCodeAt(0))
      headerView.setUint8(39, 'a'.charCodeAt(0))
      headerView.setUint32(40, contentLength, true)

      // start recording
      try {
        audioin.start()
      } catch (error) {
        fail(error)
      }
    })
  }
}
