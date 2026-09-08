import type IMU from 'imu'
import { ResourceScope } from 'owned-resources'
import { StackchanError } from 'stackchan/errors'
import type { ButtonName as ButtonRole, HeadTouchEvent, MotionEvent } from 'stackchan/extensions/input'
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
  #buttons: readonly ButtonName[] = []
  #imu: IMU | undefined
  #touchPanel: TouchPanel | undefined
  #closed = false
  #buttonListeners = new Map<string, Set<() => void>>()
  #motionListeners = new Set<(event: MotionEvent) => void>()
  #devices: ResourceScope

  constructor(params: RuntimeInputConstructorParam, devices?: ResourceScope) {
    this.#devices = devices ?? new ResourceScope()
    this.#touchPanel = params.touchPanel
    this.#imu = params.imu
    if (!devices) {
      for (const sensor of [params.touch, params.touchPanel, params.imu]) {
        if (sensor) this.#devices.own(sensor)
      }
    }
    try {
      this.#buttons = createButtonInputs(
        params.button,
        this.#devices,
        () => !this.#closed,
        (name, pressed) => {
          if (this.#closed) return
          for (const [key, listeners] of this.#buttonListeners) {
            const [role, edge] = key.split(':')
            if (name !== this.buttonFor(role as ButtonRole) || pressed !== (edge === 'press')) continue
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
    return (['a', 'b', 'c'] as const).filter((name) => this.#buttons.includes(name))[
      ['primary', 'secondary', 'tertiary'].indexOf(role)
    ]
  }

  subscribePress(listener: () => void, role: ButtonRole = 'primary'): () => void {
    return this.#subscribeButton(listener, role, 'press')
  }

  subscribeRelease(listener: () => void, role: ButtonRole = 'primary'): () => void {
    return this.#subscribeButton(listener, role, 'release')
  }

  #subscribeButton(listener: () => void, role: ButtonRole, edge: 'press' | 'release'): () => void {
    const key = `${role}:${edge}`
    this.#assertOpen()
    if (!this.buttonFor(role)) throw new StackchanError('UNSUPPORTED', `No ${role} button is available`)
    let listeners = this.#buttonListeners.get(key)
    if (!listeners) {
      listeners = new Set()
      this.#buttonListeners.set(key, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.#buttonListeners.delete(key)
    }
  }

  subscribeHeadTouch(listener: (event: HeadTouchEvent) => void): () => void {
    this.#assertOpen()
    if (!this.#touchPanel) throw new StackchanError('UNSUPPORTED', 'Head touch is unavailable')
    let active = true
    let forward: number | undefined, backward: number | undefined
    const remove = this.#touchPanel.subscribe((event) => {
      if (!active || this.#closed) return
      listener(Object.freeze({ gesture: event.gesture, tapDurationMs: event.tap?.durationMs }))
      if (event.gesture === 'forwardSwipe') forward = event.ticks
      if (event.gesture === 'backwardSwipe') backward = event.ticks
      if (
        (event.gesture === 'forwardSwipe' || event.gesture === 'backwardSwipe') &&
        forward !== undefined &&
        backward !== undefined &&
        Math.abs(forward - backward) <= 1500
      ) {
        forward = backward = undefined
        if (active && !this.#closed) listener(Object.freeze({ gesture: 'petting' }))
      }
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

  get touchPanel(): TouchPanel | undefined {
    return this.#touchPanel
  }

  get imu(): IMU | undefined {
    return this.#imu
  }

  close(): Promise<void> {
    this.#closed = true
    this.#buttonListeners.clear()
    this.#motionListeners.clear()
    return this.#devices.close()
  }
}

function createButtonInputs(
  buttons: RuntimeInputConstructorParam['button'],
  resources: ResourceScope,
  isOpen: () => boolean,
  onPress: (name: ButtonName, pressed: boolean) => void,
): readonly ButtonName[] {
  if (buttons == null) return []
  const result: ButtonName[] = []
  for (const name of ['a', 'b', 'c'] as const) {
    const rawButton = buttons[name]
    if (rawButton == null) continue
    const previous = rawButton.onChanged
    let active = true
    const handler = function (this: RawButton) {
      if (!active || !isOpen()) return
      const pressed = Boolean(this.read())
      onPress(name, pressed)
    }
    resources.defer(() => {
      active = false
      if (rawButton.onChanged === handler) rawButton.onChanged = previous
    })
    rawButton.onChanged = handler
    result.push(name)
  }
  return result
}
