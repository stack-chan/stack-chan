import type { Button } from 'capabilities'
import type IMU from 'imu'
import { createButtonInputEvent } from 'input-event'
import { StackchanError } from 'stackchan/errors'
import Time from 'time'
import type Touch from 'touch'
import type TouchPanel from 'touch-panel'

type ButtonName = 'a' | 'b' | 'c' | 'power'

type RawButton = {
  read: () => number
  onChanged: (this: RawButton) => void
}

export type RuntimeInputConstructorParam = {
  button?: Partial<Record<ButtonName, RawButton>>
  touch?: Touch
  touchPanel?: TouchPanel
  imu?: IMU
}

export class StackchanRuntimeInput {
  #button: Partial<Record<ButtonName, Button>> | undefined
  #imu: IMU | undefined
  #touch: Touch | undefined
  #touchPanel: TouchPanel | undefined
  #closed = false
  #restoreButtons: Array<() => void> = []
  #pressListeners = new Set<() => void>()

  constructor(params: RuntimeInputConstructorParam) {
    this.#button = createButtonInputs(params.button, this.#restoreButtons, (name, pressed) => {
      if (this.#closed || !pressed || name !== this.primaryButton) return
      for (const listener of [...this.#pressListeners]) listener()
    })
    this.#touch = params.touch
    this.#touchPanel = params.touchPanel
    this.#imu = params.imu
    try {
      this.#touchPanel?.start()
    } catch (error) {
      try {
        this.close()
      } catch {
        /* Preserve the initialization error. */
      }
      throw error
    }
  }

  get primaryButton(): 'a' | 'b' | 'c' | undefined {
    return (['a', 'b', 'c'] as const).find((name) => this.#button?.[name] !== undefined)
  }

  subscribePress(listener: () => void): () => void {
    if (this.#closed) throw new StackchanError('CLOSED', 'Input is closed')
    if (!this.primaryButton) throw new StackchanError('UNSUPPORTED', 'No primary button is available')
    this.#pressListeners.add(listener)
    return () => {
      this.#pressListeners.delete(listener)
    }
  }

  get button() {
    return this.#button
  }

  get touch() {
    return this.#touch
  }

  get touchPanel(): TouchPanel | undefined {
    return this.#touchPanel
  }

  get imu(): IMU | undefined {
    return this.#imu
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#pressListeners.clear()
    const closers = [
      ...this.#restoreButtons.reverse(),
      () => this.#imu?.close(),
      () => this.#touchPanel?.close(),
      () => this.#touch?.close(),
    ]
    this.#restoreButtons = []
    let failed = false
    let failure: unknown
    for (const close of closers) {
      try {
        close()
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
    }
    if (failed) throw failure
  }
}

function createButtonInputs(
  buttons: RuntimeInputConstructorParam['button'],
  restore: Array<() => void>,
  onPress: (name: ButtonName, pressed: boolean) => void,
): Partial<Record<ButtonName, Button>> | undefined {
  if (buttons == null) return undefined
  const result: Partial<Record<ButtonName, Button>> = {}
  for (const name of ['a', 'b', 'c', 'power'] as const) {
    const rawButton = buttons[name]
    if (rawButton == null) continue
    const button: Button = {}
    const previous = rawButton.onChanged
    let active = true
    const handler = function (this: RawButton) {
      if (!active) return
      const pressed = Boolean(this.read())
      button.onEvent?.(createButtonInputEvent(name, pressed, Time.ticks))
      onPress(name, pressed)
    }
    rawButton.onChanged = handler
    restore.push(() => {
      active = false
      button.onEvent = undefined
      if (rawButton.onChanged === handler) rawButton.onChanged = previous
    })
    result[name] = button
  }
  return result
}
