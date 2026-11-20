class ChatAudioIO {
  constructor(options) {
    this.options = options
    ChatAudioIO.lastOptions = options
    ChatAudioIO.instances.push(this)
    this.state = ChatAudioIO.DISCONNECTED
    this.error = ''
    this.lastText = null
    this.lastFunctionResult = null
    this.lastListeningMode = null
    this.stopListeningCount = 0
    this.lastWakeWord = null
    this.lastAbortReason = null
    this.lastMcpPayload = null
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
    if (this.state < ChatAudioIO.CONNECTED) throw new Error('not connected')
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

  startListening(mode) {
    this.lastListeningMode = mode
  }

  stopListening() {
    this.stopListeningCount += 1
  }

  notifyWakeWordDetected(text) {
    this.lastWakeWord = text
  }

  abort(reason) {
    this.lastAbortReason = reason
  }

  sendMcpMessage(payload) {
    this.lastMcpPayload = payload
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

  emitEmotion(emotion, text) {
    this.options.onEmotionChanged?.(emotion, text)
  }

  emitAlert(alert) {
    this.options.onAlert?.(alert)
  }
}

ChatAudioIO.FAILED = -1
ChatAudioIO.DISCONNECTED = 0
ChatAudioIO.DISCONNECTING = 1
ChatAudioIO.CONNECTING = 2
ChatAudioIO.CONNECTED = 3
ChatAudioIO.SPEAKING = 4
ChatAudioIO.LISTENING = 5
ChatAudioIO.WAITING = 6
ChatAudioIO.instances = []
ChatAudioIO.lastOptions = null

export default ChatAudioIO
