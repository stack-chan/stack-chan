import type { Button } from 'capabilities'
import type IMU from 'imu'
import type Touch from 'touch'
import type TouchPanel from 'touch-panel'

type ButtonName = 'a' | 'b' | 'c' | 'power'

export type RuntimeInputConstructorParam = {
  button?: Partial<Record<ButtonName, Button>>
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
    this.#button = params.button
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
}
