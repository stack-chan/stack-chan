export type TimerHandle = unknown
export type SetTimer = (handler: () => void, timeout: number) => TimerHandle
export type ClearTimer = (handle: TimerHandle) => void

export default class SingleWaitSlot<T> {
  #setTimer: SetTimer
  #clearTimer: ClearTimer
  #resolve: ((value: T | undefined) => void) | null = null
  #timerHandle: TimerHandle | null = null

  constructor(setTimer: SetTimer, clearTimer: ClearTimer) {
    this.#setTimer = setTimer
    this.#clearTimer = clearTimer
  }

  get isWaiting(): boolean {
    return this.#resolve != null
  }

  wait(timeout: number, onTimeout?: () => void): Promise<T | undefined> {
    if (this.#resolve != null) {
      throw new Error('wait slot is already in use')
    }
    return new Promise((resolve) => {
      this.#resolve = (value) => {
        this.#resolve = null
        resolve(value)
      }
      this.#timerHandle = this.#setTimer(() => {
        const resolver = this.#resolve
        this.#resolve = null
        this.#timerHandle = null
        onTimeout?.()
        resolver?.(undefined)
      }, timeout)
    })
  }

  resolve(value: T): void {
    if (this.#resolve == null) {
      return
    }
    if (this.#timerHandle != null) {
      this.#clearTimer(this.#timerHandle)
      this.#timerHandle = null
    }
    const resolver = this.#resolve
    this.#resolve = null
    resolver(value)
  }
}
