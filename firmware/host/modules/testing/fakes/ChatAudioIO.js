export default class ChatAudioIO {
  static FAILED = -1
  static DISCONNECTED = 0
  static DISCONNECTING = 1
  static CONNECTING = 2
  static CONNECTED = 3
  static SPEAKING = 4
  static LISTENING = 5
  static WAITING = 6
  static instances = []
  static lastOptions = null

  constructor(options) {
    this.options = options
    ChatAudioIO.lastOptions = options
    ChatAudioIO.instances.push(this)
    this.state = ChatAudioIO.DISCONNECTED
    this.error = ''
    this.lastText = null
    this.lastFunctionResult = null
    this.microphone = true
    this.volume = 1
  }

  connect() {
    this.state = ChatAudioIO.CONNECTING
    this.options.onStateChanged?.(this.state)
  }

  disconnect() {
    this.state = ChatAudioIO.DISCONNECTING
    this.options.onStateChanged?.(this.state)
    this.state = ChatAudioIO.DISCONNECTED
    this.options.onStateChanged?.(this.state)
  }

  close() {}

  sendText(text) {
    if (this.state < ChatAudioIO.CONNECTED) {
      throw new Error('not connected')
    }
    this.lastText = text
  }

  sendFunctionResult(call, name, result) {
    this.lastFunctionResult = { call, name, result }
  }

  changeMicrophone(enabled) {
    this.microphone = enabled
  }

  changeVolume(volume) {
    this.volume = volume
  }

  emitState(state, error) {
    this.state = state
    if (error) this.error = error
    this.options.onStateChanged?.(state)
  }

  emitInputLevel(level) {
    this.options.onInputLevelChanged?.(level)
  }

  emitOutputLevel(level) {
    this.options.onOutputLevelChanged?.(level)
  }

  emitInputTranscript(text, more = false) {
    this.options.onInputTranscript?.(text, more)
  }

  emitOutputTranscript(text, more = false) {
    this.options.onOutputTranscript?.(text, more)
  }

  emitFunctionCall(call, name, parameters) {
    this.options.onFunctionCall?.(call, name, parameters)
  }
}
