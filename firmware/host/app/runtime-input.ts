import type { Button } from 'capabilities'
import type IMU from 'imu'
import { createButtonInputEvent } from 'input-event'
import { ResourceScope } from 'owned-resources'
import { StackchanError } from 'stackchan/errors'
import type { ButtonName as ButtonRole, HeadTouchEvent, MotionEvent } from 'stackchan/extensions/input'
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
  #pressListeners = new Map<ButtonRole, Set<() => void>>()
  #motionListeners = new Set<(event: MotionEvent) => void>()
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
          if (this.#closed || !pressed) return
          for (const [role, listeners] of this.#pressListeners) {
            if (name !== this.buttonFor(role)) continue
            for (const listener of [...listeners]) {
              if (this.#closed) return
              if (listeners.has(listener)) listener()
            }
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
    return this.buttonFor('primary')
  }

  buttonFor(role: ButtonRole): 'a' | 'b' | 'c' | undefined {
    return (['a', 'b', 'c'] as const).filter((name) => this.#button?.[name] !== undefined)[
      ['primary', 'secondary', 'tertiary'].indexOf(role)
    ]
  }

  subscribePress(listener: () => void, role: ButtonRole = 'primary'): () => void {
    this.#assertOpen()
    if (!this.buttonFor(role)) throw new StackchanError('UNSUPPORTED', `No ${role} button is available`)
    let listeners = this.#pressListeners.get(role)
    if (!listeners) {
      listeners = new Set()
      this.#pressListeners.set(role, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.#pressListeners.delete(role)
    }
  }

  subscribeHeadTouch(listener: (event: HeadTouchEvent) => void): () => void {
    this.#assertOpen()
    if (!this.#touchPanel) throw new StackchanError('UNSUPPORTED', 'Head touch is unavailable')
    let active = true
    const remove = this.#touchPanel.subscribe((event) => {
      if (active && !this.#closed)
        listener(Object.freeze({ gesture: event.gesture, tapDurationMs: event.tap?.durationMs }))
    })
    return () => {
      if (!active) return
      active = false
      remove()
    }
  }

  subscribeMotion(listener: (event: MotionEvent) => void): () => void {
    this.#assertOpen()
    const imu = this.#imu
    if (!imu) throw new StackchanError('UNSUPPORTED', 'Motion input is unavailable')
    if (!this.#motionListeners.size) {
      if (imu.onEvent) throw new StackchanError('BUSY', 'Motion input is already in use')
      imu.onEvent = this.#onMotion
      try {
        imu.start()
      } catch (error) {
        imu.onEvent = undefined
        imu.stop()
        throw error
      }
    }
    this.#motionListeners.add(listener)
    return () => {
      if (!this.#motionListeners.delete(listener)) return
      if (!this.#motionListeners.size && imu.onEvent === this.#onMotion) {
        imu.onEvent = undefined
        imu.stop()
      }
    }
  }

  #onMotion = (event: MotionEvent): void => {
    const input = Object.freeze({ motion: event.motion })
    for (const listener of [...this.#motionListeners]) {
      if (this.#closed) return
      if (this.#motionListeners.has(listener)) listener(input)
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new StackchanError('CLOSED', 'Input is closed')
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
    this.#motionListeners.clear()
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
