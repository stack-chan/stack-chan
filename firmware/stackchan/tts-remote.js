/* eslint-disable prefer-const */
import { Request } from 'http'
import AudioOut from 'pins/audioout'
import Timer from 'timer'
import config from 'mc/config'
/* global trace, SharedArrayBuffer */
const BYTE_LENGTH = 1024
const BUF_INDICES = 8
const TIMEOUT = 10000
let buffer
let view
let promise
let handler

function enqueueWait(audioOut, ...values) {
  /* keep retrying until queue is not full */
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      audioOut.enqueue(...values)
      break
    } catch (e) {
      if (e.message !== '(host): queue full') {
        throw e
      }
    }
  }
}

class TTS {
  static async speak(string) {
    if (handler != null) {
      return -1
    }
    let audioOut = new AudioOut({
      streams: 1,
      bitsPerSample: 16,
      numChannels: 1,
      sampleRate: 22050,
    })
    if (buffer == null) {
      buffer = new SharedArrayBuffer(BYTE_LENGTH * BUF_INDICES + 4)
      view = new DataView(buffer)
    }
    const host = config.tts?.host || '127.0.0.1'
    const port = config.tts?.port || 8080
    promise = new Promise((resolve, reject) => {
      let bufIdx = 0
      let numFragments = 0
      let bytes = 0
      const cleanup = () => {
        trace('cleaning up\n')
        if (handler != null) {
          Timer.clear(handler)
          handler = null
        }
        audioOut.close()
        audioOut = null
      }
      const onFinish = () => {
        trace('onFinish\n')
        cleanup()
        resolve(bytes)
      }
      const onReject = () => {
        trace('onReject\n')
        cleanup()
        reject(-1)
      }
      handler = Timer.set(() => {
        handler = null
        onReject()
      }, TIMEOUT)
      audioOut.start()
      audioOut.enqueue(0, AudioOut.Flush)
      audioOut.enqueue(0, AudioOut.Volume, 128)
      audioOut.callback = () => {
        trace(`all samples played. ${numFragments} fragments, ${bytes} bytes\n`)
        Timer.set(onFinish, 0)
      }
      const request = new Request({
        host,
        port,
        path: `/api/tts?text=${string.replaceAll(' ', '%20')}`,
        method: 'GET',
      })
      let idx = 0
      request.callback = function (message) {
        if (Request.responseFragment === message) {
          let chunk = this.read(ArrayBuffer)
          let len = chunk.byteLength
          bytes += len
          // copy chunk to shared array buffer
          let sourceView = new DataView(chunk)
          let offset = bufIdx * BYTE_LENGTH
          let i = numFragments === 0 ? Math.min(128, len) : 0
          if (numFragments < BUF_INDICES) {
            for (; i < len; i++) {
              if (idx >= BYTE_LENGTH) {
                enqueueWait(audioOut, 0, AudioOut.RawSamples, buffer, 1, offset >> 1, BYTE_LENGTH >> 1)
                bufIdx = (bufIdx + 1) % BUF_INDICES
                offset = bufIdx * BYTE_LENGTH
                idx = 0
              }
              view.setUint8(offset + idx, sourceView.getUint8(i))
              idx += 1
            }
          } else {
            for (; i < len - 1; i += 2) {
              if (idx >= BYTE_LENGTH) {
                enqueueWait(audioOut, 0, AudioOut.RawSamples, buffer, 1, offset >> 1, BYTE_LENGTH >> 1)
                bufIdx = (bufIdx + 1) % BUF_INDICES
                offset = bufIdx * BYTE_LENGTH
                idx = 0
              }
              view.setUint16(offset + idx, sourceView.getUint16(i, true), true)
              idx += 2
            }
            if (len % 2 > 0) {
              // last one byte
              view.setUint8(offset + idx, sourceView.getUint8(i))
              idx += 1
            }
          }
          numFragments += 1
        }
        if (Request.responseComplete == message) {
          if (idx > 0) {
            enqueueWait(audioOut, 0, AudioOut.RawSamples, buffer, 1, (bufIdx * BYTE_LENGTH) >> 1, idx >> 1)
          }
          trace('audioout enqueue\n')
          enqueueWait(audioOut, 0, AudioOut.Callback, 0)
        }
        if (message < 0) {
          trace('exception occured: ' + message + '\n')
          onReject()
        }
      }
    })
    return promise
  }
}
export default TTS
