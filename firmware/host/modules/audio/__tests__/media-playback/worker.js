export const workers = []
export default class Worker {
  messages = []
  constructor() {
    workers.push(this)
  }
  postMessage(message) {
    this.messages.push(message)
    if (message.id === 'close') Promise.resolve().then(() => this.send({ id: 'closed' }))
  }
  terminate() {
    this.terminated = true
  }
  send(message) {
    this.onmessage(message)
  }
}
