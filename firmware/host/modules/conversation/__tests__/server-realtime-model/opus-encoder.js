export default class OpusEncoder {
  static instances = []

  constructor() {
    this.encodeUs = 120
    this.inputBytes = 12
    this.outputBytes = 8
    this.internalHeapBytes = 2048
    this.psramHeapBytes = 4096
    this.inputs = []
    this.packets = []
    OpusEncoder.instances.push(this)
  }

  close() {
    this.closed = true
  }

  enqueue(input) {
    this.inputs.push(new Uint8Array(input).slice())
    this.packets.push(Uint8Array.of(0xf8, 0xff, 0xfe))
  }

  read(output) {
    const packet = this.packets.shift()
    if (!packet) return 0
    new Uint8Array(output).set(packet)
    return packet.byteLength
  }

  clear() {
    this.packets.length = 0
  }
}
