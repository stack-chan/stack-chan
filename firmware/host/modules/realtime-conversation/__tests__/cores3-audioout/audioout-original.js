export const outputs = []
export class Mixer {}

export default class AudioOut {
  constructor(options) {
    this.sampleRate = options.sampleRate
    this.closed = false
    outputs.push(this)
  }
  close() {
    this.closed = true
  }
}
