import type { Button } from 'capabilities'
import type IMU from 'imu'
import { createButtonInputEvent } from 'input-event'
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

  constructor(params: RuntimeInputConstructorParam) {
    this.#button = createButtonInputs(params.button)
    this.#touch = params.touch
    this.#touchPanel = params.touchPanel
    this.#touchPanel?.start()
    this.#imu = params.imu
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
    this.#touch?.close()
    this.#touchPanel?.close()
    this.#imu?.close()
  }
}

function createButtonInputs(
  buttons: RuntimeInputConstructorParam['button'],
): Partial<Record<ButtonName, Button>> | undefined {
  if (buttons == null) return undefined
  const result: Partial<Record<ButtonName, Button>> = {}
  for (const name of ['a', 'b', 'c', 'power'] as const) {
    const rawButton = buttons[name]
    if (rawButton == null) continue
    const button: Button = {}
    rawButton.onChanged = function () {
      button.onEvent?.(createButtonInputEvent(name, Boolean(this.read()), Time.ticks))
    }
    result[name] = button
  }
  return result
}
