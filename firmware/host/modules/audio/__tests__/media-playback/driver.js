export const outputs = []
export default class Output {
  volume = 0
  writes = []
  closed = false
  constructor(options) {
    this.options = options
    outputs.push(this)
  }
  start() {
    this.writable(16)
  }
  stop() {}
  close() {
    this.closed = true
  }
  write(bytes) {
    this.writes.push(bytes.slice())
  }
  writable(size) {
    this.options.onWritable(size)
  }
}
