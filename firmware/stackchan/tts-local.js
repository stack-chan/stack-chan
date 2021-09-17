/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import Resource from 'Resource'
import speechData from 'speeches'
import Timer from 'timer'

const speeches = speechData.speeches
const speechDic = new Map()
for (const [key, text] of Object.entries(speeches)) {
  speechDic.set(text, key)
}
/* global trace, SharedArrayBuffer */

let audioOut

class TTS {
  static async speak(text) {
    const key = speechDic.get(text)
    if (key == null) {
      throw new Error(`No speech for "${text}"`)
    }
    return this.playSpeech(key)
  }
  static async playSpeech(key) {
    return new Promise((resolve, reject) => {
      let handler = Timer.set(() => {
        trace('TTS: timeout')
        audioOut.stop()
        resolve()
      }, 30000)

      const resource = new Resource(key + '.maud')
      const header = new Uint8Array(resource.slice(0, 12))
      const bitsPerSample = header[3]
      const sampleRate = (header[5] << 8) | header[4]
      const numChannels = header[6]
      trace(header.toString() + '\n')
      if (audioOut == null) {
        audioOut = new AudioOut({
          streams: 1,
          bitsPerSample,
          numChannels,
          sampleRate,
        })
      }
      audioOut.callback = () => {
        Timer.clear(handler)
        audioOut.stop()
        resolve()
      }
      audioOut.enqueue(0, AudioOut.Flush)
      audioOut.enqueue(0, AudioOut.Volume, 128)
      audioOut.enqueue(0, AudioOut.Samples, resource)
      audioOut.enqueue(0, AudioOut.Callback, 0)
      audioOut.start()
    })
  }
}
export default TTS
