export const workers = []
export default class Worker {
  messages = []
  constructor() {
    workers.push(this)
  }
  postMessage(message) {
    this.messages.push(message)
  }
  terminate() {
    this.terminated = true
  }
  send(message) {
    this.onmessage(message)
  }
}
