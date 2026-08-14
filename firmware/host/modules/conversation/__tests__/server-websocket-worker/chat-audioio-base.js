export default class ChatAudioIOBase {
  static SPEAKING = 4
  static WAITING = 6

  constructor(options) {
    this.error = ''
    this.state = ChatAudioIOBase.SPEAKING
    this.onStateChanged = options.onStateChanged ?? (() => {})
    this.createWorker(options.specifier)
  }

  ensureInput() {}

  failed(message) {
    this.error = message.string
  }
}
