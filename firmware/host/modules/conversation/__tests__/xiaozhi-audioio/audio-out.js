export default class AudioOut {
  static instances = []
  constructor(options) {
    this.options = options
    this.writes = []
    AudioOut.instances.push(this)
  }
  start() {}
  close() {
    this.closed = true
  }
  write(samples) {
    this.writes.push(new Uint8Array(samples).slice())
  }
  tick(size = 960) {
    if (!this.closed) this.options.onWritable(size)
  }
}
