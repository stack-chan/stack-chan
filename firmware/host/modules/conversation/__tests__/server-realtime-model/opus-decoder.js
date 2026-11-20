export default class OpusDecoder {
  static instances = []

  constructor(sampleRate, frameDuration) {
    this.sampleRate = sampleRate
    this.frameDuration = frameDuration
    this.outputBytes = (sampleRate * frameDuration * 2) / 1000
    this.decodeUs = 240
    this.internalHeapBytes = 1024
    this.psramHeapBytes = 2048
    this.inputs = []
    OpusDecoder.instances.push(this)
  }

  close() {
    this.closed = true
  }

  decode(input, output) {
    this.inputs.push(new Uint8Array(input).slice())
    new Uint8Array(output).fill(0x34)
    return this.outputBytes
  }
}
