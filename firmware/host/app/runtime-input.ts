import type { Button } from 'capabilities'
import type IMU from 'imu'
import { createButtonInputEvent } from 'input-event'
import { ResourceScope } from 'owned-resources'
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
  #pressListeners = new Set<() => void>()
  #devices: ResourceScope

  constructor(params: RuntimeInputConstructorParam, devices?: ResourceScope) {
    this.#devices = devices ?? new ResourceScope()
    this.#touch = params.touch
    this.#touchPanel = params.touchPanel
    this.#imu = params.imu
    if (!devices) {
      for (const sensor of [params.touch, params.touchPanel, params.imu]) {
        if (sensor) this.#devices.own(sensor)
      }
    }
    try {
      this.#button = createButtonInputs(
        params.button,
        this.#devices,
        () => !this.#closed,
        (name, pressed) => {
          if (this.#closed || !pressed || name !== this.primaryButton) return
          for (const listener of [...this.#pressListeners]) {
            if (this.#closed) break
            listener()
          }
        },
      )
      this.#touchPanel?.start()
    } catch (error) {
      // Restore borrowed buttons immediately. The host awaits this same scope
      // during rollback, including a failure from one of the physical closers.
      void this.close().catch((cleanupError) => trace(`[input] cleanup failed: ${String(cleanupError)}\n`))
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

  close(): Promise<void> {
    this.#closed = true
    this.#pressListeners.clear()
    return this.#devices.close()
  }
}

function createButtonInputs(
  buttons: RuntimeInputConstructorParam['button'],
  resources: ResourceScope,
  isOpen: () => boolean,
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
      if (!active || !isOpen()) return
      const pressed = Boolean(this.read())
      button.onEvent?.(createButtonInputEvent(name, pressed, Time.ticks))
      onPress(name, pressed)
    }
    resources.defer(() => {
      active = false
      button.onEvent = undefined
      if (rawButton.onChanged === handler) rawButton.onChanged = previous
    })
    rawButton.onChanged = handler
    result[name] = button
  }
  return result
}
