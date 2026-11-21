export default class SilentInput {
  constructor({ sampleRate, channels }) {
    this.sampleRate = sampleRate
    this.channels = channels
  }
  start() {}
  close() {}
  read() {
    return 0
  }
}
