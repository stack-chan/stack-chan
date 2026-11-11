import Timer from 'timer'

export default class Native {
  static active = 0
  static lastKana = ''
  static reads = 0
  #remaining = 0
  #failed = false
  #stopping = false
  start(kana: string) {
    Native.lastKana = kana
    if (Native.active) throw Error('native busy')
    Native.active++
    this.#remaining = 5007
    this.#failed = kana === 'missing-model'
  }
  get done() {
    return this.#remaining === 0 || this.#failed
  }
  get available() {
    return this.#remaining ? 12500 : 0
  }
  read(buffer: ArrayBuffer) {
    Native.reads++
    if (this.#failed) throw Error('model not installed')
    if (!this.#remaining) return -1
    const view = new Int16Array(buffer)
    const count = Math.min(this.#remaining, view.length)
    for (let i = 0; i < count; i++) view[i] = 5007 - this.#remaining + i
    this.#remaining -= count
    return count
  }
  stop() {
    if (this.done || this.#stopping) return
    this.#stopping = true
    Timer.set(() => {
      this.#remaining = 0
    }, 2)
  }
  close() {
    if (!this.done) throw Error('premature close')
    Native.active--
  }
}
