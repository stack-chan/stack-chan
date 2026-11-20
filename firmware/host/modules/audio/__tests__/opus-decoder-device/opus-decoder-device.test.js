import AudioIn from 'embedded:io/audio/in'
import Worker from 'worker'

const worker = new Worker('opusCodecWorker', {
  static: 512 * 1024,
  chunk: { initial: 64 * 1024, incremental: 8 * 1024 },
  heap: { initial: 1024, incremental: 256 },
  stack: 1024,
  nativeStack: 64 * 1024,
})
worker.onmessage = (message) => {
  worker.terminate()
  if (message.error) throw new Error(message.error)
  trace(
    `[opus-device-test] decoded=${message.decodedBytes}B decode=${message.decodeUs}us encoded=${message.encodedBytes}B encode=${message.encodeUs}us internal=${message.internalHeapBytes}B psram=${message.psramHeapBytes}B\n`,
  )
  trace('ok\n')
}

const pcm = new SharedArrayBuffer(1920)
const frame = new Uint8Array(pcm)
let offset = 0
const input = new AudioIn({
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  onReadable(size) {
    const chunk = new Uint8Array(size)
    this.read(chunk)
    const copied = Math.min(chunk.byteLength, frame.byteLength - offset)
    frame.set(chunk.subarray(0, copied), offset)
    offset += copied
    if (offset !== frame.byteLength) return
    this.close()
    worker.postMessage({ pcm })
  },
})
input.start()
