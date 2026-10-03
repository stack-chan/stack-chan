export default class AudioIn {
  static instances = []
  constructor(options) {
    this.options = options
    AudioIn.instances.push(this)
  }
  start() {}
  close() {
    this.closed = true
  }
}
