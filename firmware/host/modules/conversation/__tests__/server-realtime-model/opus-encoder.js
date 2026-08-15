export default class OpusEncoder {
  static instances = []

  constructor() {
    this.encodeUs = 120
    this.inputBytes = 12
    this.outputBytes = 8
    this.internalHeapBytes = 2048
    this.psramHeapBytes = 4096
    this.inputs = []
    OpusEncoder.instances.push(this)
  }

  close() {
    this.closed = true
  }

  encode(input, output) {
    this.inputs.push(new Uint8Array(input).slice())
    new Uint8Array(output).set([0xf8, 0xff, 0xfe])
    return 3
  }
}
