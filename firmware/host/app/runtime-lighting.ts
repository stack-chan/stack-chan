import type { RobotLed } from 'capabilities'
import { ResourceScope } from 'owned-resources'
import { ownLed } from 'runtime-resources'
import { StackchanError } from 'stackchan/errors'

export type RuntimeLightingConstructorParam = {
  led?: Record<string, RobotLed>
}

export class StackchanRuntimeLighting {
  #led: Record<string, RobotLed>
  #devices: ResourceScope

  constructor(params: RuntimeLightingConstructorParam, devices?: ResourceScope) {
    this.#led = params.led ?? {}
    this.#devices = devices ?? new ResourceScope()
    if (!devices) for (const led of Object.values(this.#led)) ownLed(this.#devices, led)
  }

  get led() {
    return this.#led
  }

  lightOn(ledName: string, r: number, g: number, b: number, duration?: number, index?: number, count?: number) {
    this.#assertOpen()
    const led = this.#led[ledName]
    if (led) {
      led.on(r, g, b, duration, index, count)
    }
  }

  lightOff(ledName: string, index?: number, count?: number) {
    this.#assertOpen()
    const led = this.#led[ledName]
    if (led) {
      led.off(index, count)
    }
  }

  lightBlink(ledName: string, r: number, g: number, b: number, duration: number, index?: number, count?: number) {
    this.#assertOpen()
    const led = this.#led[ledName]
    if (led) {
      led.blink(r, g, b, duration, index, count)
    }
  }

  lightRainbow(ledName: string, index?: number, count?: number) {
    this.#assertOpen()
    const led = this.#led[ledName]
    if (led) {
      led.rainbow(index, count)
    }
  }

  close(): Promise<void> {
    return this.#devices.close()
  }

  #assertOpen(): void {
    if (this.#devices.closed) throw new StackchanError('CLOSED', 'Lighting is closed')
  }
}
