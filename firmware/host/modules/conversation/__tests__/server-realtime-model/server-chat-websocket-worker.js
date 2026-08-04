export const sentJSON = []
export const postedMessages = []

export default class ServerChatWebSocketWorker {
  constructor(options) {
    this.options = options
  }

  connect(message) {
    this.inputBuffer = message.inputBuffer
    this.outputBuffer = message.outputBuffer
  }

  close() {
    this.closed = true
  }

  post(id, param) {
    postedMessages.push({ id, ...param })
  }

  postMessage(message) {
    postedMessages.push(message)
  }

  sendAudio(message) {
    this.lastAudio = message
  }

  sendAudioBuffer(buffer) {
    this.lastAudioBuffer = buffer
  }

  sendJSON(message) {
    sentJSON.push(message)
  }
}
