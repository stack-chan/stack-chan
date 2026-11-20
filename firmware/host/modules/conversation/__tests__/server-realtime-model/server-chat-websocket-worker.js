export const sentJSON = []
export const postedMessages = []
export const sentBinary = []

export default class ServerChatWebSocketWorker {
  constructor(options) {
    this.options = options
    this.connectCount = 0
  }

  connect(message) {
    this.connectCount += 1
    this.inputBuffer = message.inputBuffer
    this.outputBuffer = message.outputBuffer
    this.parser = {
      copied: [],
      copy: (data) => this.parser.copied.push(new Uint8Array(data).slice()),
      doneCount: 0,
      done: () => (this.parser.doneCount += 1),
    }
  }

  read(data, options) {
    this.lastRead = { data, options }
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
    this.lastAudio = { ...message }
    this.sendAudioBuffer(new Uint8Array(this.inputBuffer, message.offset, message.size).slice())
  }

  sendAudioBuffer(buffer) {
    this.lastAudioBuffer = buffer
  }

  sendJSON(message) {
    sentJSON.push(message)
  }

  write(data, options) {
    sentBinary.push({ data: new Uint8Array(data).slice(), options })
  }
}
