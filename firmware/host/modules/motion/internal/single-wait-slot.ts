export type TimerHandle = unknown
export type SetTimer = (handler: () => void, timeout: number) => TimerHandle
export type ClearTimer = (handle: TimerHandle) => void
export type WaitSlotCallback<T> = (value: T | undefined) => void

export default class SingleWaitSlot<T> {
  #setTimer: SetTimer
  #clearTimer: ClearTimer
  #callback: WaitSlotCallback<T> | null = null
  #timerHandle: TimerHandle | null = null

  constructor(setTimer: SetTimer, clearTimer: ClearTimer) {
    this.#setTimer = setTimer
    this.#clearTimer = clearTimer
  }

  get isWaiting(): boolean {
    return this.#callback != null
  }

  wait(timeout: number, callback: WaitSlotCallback<T>, onTimeout?: () => void): void {
    if (this.#callback != null) {
      throw new Error('wait slot is already in use')
    }
    this.#callback = (value) => {
      this.#callback = null
      callback(value)
    }
    this.#timerHandle = this.#setTimer(() => {
      const callback = this.#callback
      this.#callback = null
      this.#timerHandle = null
      onTimeout?.()
      callback?.(undefined)
    }, timeout)
  }

  resolve(value: T): void {
    if (this.#callback == null) {
      return
    }
    if (this.#timerHandle != null) {
      this.#clearTimer(this.#timerHandle)
      this.#timerHandle = null
    }
    const callback = this.#callback
    this.#callback = null
    callback(value)
  }
}
