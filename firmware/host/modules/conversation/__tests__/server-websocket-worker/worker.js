export const workers = []

export default class Worker {
  constructor() {
    this.messages = []
    workers.push(this)
  }

  get audioMessages() {
    return this.messages.filter((message) => message.id === 'sendAudio')
  }

  postMessage(message) {
    this.messages.push(message)
  }

  terminate() {}
}
