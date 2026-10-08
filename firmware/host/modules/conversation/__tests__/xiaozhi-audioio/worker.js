export default class Worker {
  static instances = []
  constructor() {
    this.messages = []
    Worker.instances.push(this)
  }
  postMessage(message) {
    this.messages.push(message)
  }
  terminate() {
    this.closed = true
  }
}
