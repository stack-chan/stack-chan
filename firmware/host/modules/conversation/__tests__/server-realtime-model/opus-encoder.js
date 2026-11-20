export default class OpusEncoder {
  static instances = []

  constructor() {
    this.encodeUs = 120
    this.inputBytes = 12
    this.outputBytes = 8
    this.internalHeapBytes = 2048
    this.psramHeapBytes = 4096
    this.packets = []
    this.capturedPcmBytes = 0
    this.droppedPcmBytes = 0
    this.attachedRing = undefined
    OpusEncoder.instances.push(this)
  }

  close() {
    this.closed = true
  }

  attachPcmRing(data, state) {
    this.attachedRing = { data, state }
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
