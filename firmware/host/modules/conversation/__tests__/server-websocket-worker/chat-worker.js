export const postedMessages = []

export default class ChatWorker {
  constructor(options) {
    this.options = options
  }

  connect(message) {
    this.inputBuffer = message.inputBuffer
    this.outputBuffer = message.outputBuffer
  }

  postMessage(message) {
    postedMessages.push(message)
  }
}
