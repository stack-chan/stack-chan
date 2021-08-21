/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import Resource from 'resource'
import speeches from 'speeches'
import Timer from 'timer'
import { resolveModuleName } from 'typescript'

const speechDic = new Map()
for (const { key, text } of speeches) {
  speechDic.set(text, key)
}
/* global trace, SharedArrayBuffer */

let audioOut

class TTS {
  static async speak(text) {
    if (audioOut == null) {
      audioOut = new AudioOut({
        streams: 1,
        bitsPerSample: 16,
        numChannels: 1,
        sampleRate: 22050,
      })
    }
    new Promise((resolve, reject) => {
      let handler = Timer.set(() => {
        trace('TTS: timeout')
        audioOut.stop()
        reject()
      }, 20000)
      audioOut.callback = () => {
        Timer.clear(handler)
        audioOut.stop()
        resolve()
      }
      const key = speechDic.get(text)
      if (key == null) {
        throw new Error(`No speech for "${text}"`)
      }
      const resource = new Resource(key + '.maud')
      audioOut.enqueue(0, AudioOut.Flush)
      audioOut.enqueue(0, AudioOut.Volume, 128)
      audioOut.enqueue(0, AudioOut.Samples, resource)
      audioOut.enqueue(0, AudioOut.Callback, 0)
      audioOut.start()
    })
  }
}
export default TTS
