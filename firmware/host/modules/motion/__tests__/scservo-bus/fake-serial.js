export default class FakeSerial {
  static instance
  writes = []
  incoming = []
  failures = 0
  constructor(options) {
    this.options = options
    this.format = options.format
    FakeSerial.instance = this
  }
  write(bytes) {
    if (this.failures > 0) {
      this.failures--
      throw new Error('serial write failed')
    }
    this.writes.push(Uint8Array.from(bytes))
  }
  read() {
    return this.incoming.shift()
  }
  inject(bytes) {
    this.incoming.push(...bytes)
    this.options.onReadable.call(this, bytes.length)
  }
}
