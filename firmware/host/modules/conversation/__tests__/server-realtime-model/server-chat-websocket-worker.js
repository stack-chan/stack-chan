export const sentJSON = []
export const postedMessages = []

export default class ServerChatWebSocketWorker {
  constructor(options) {
    this.options = options
    this.connectCount = 0
  }

  connect(message) {
    this.connectCount += 1
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

  onBase64(offset, size) {
    postedMessages.push({ id: 'receiveAudio', offset, size })
  }

  sendAudio(message) {
    this.lastAudio = { ...message }
    this.sendAudioBuffer(new Uint8Array(this.inputBuffer, message.offset, message.size).slice())
  }

  sendAudioBuffer(buffer) {
    this.lastAudioBuffer = buffer
  }

  sendJSON(message) {
    sentJSON.push(message)
  }
}
