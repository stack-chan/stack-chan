import { scan } from 'mp3-frames'
export default class Decoder {
  static BUFFER_GUARD = 0
  static scan(bytes, start, end, info) {
    return scan(bytes, start, end, info)
  }
  decode(bytes, output) {
    const frame = scan(bytes, 0, bytes.length)
    output.samples = frame.samples
    output.sampleRate = frame.sampleRate
    new Int16Array(output).fill(123)
    return frame.length
  }
  close() {}
}
