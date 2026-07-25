import type { RobotLed } from 'capabilities'

export type RuntimeLightingConstructorParam = {
  led?: Record<string, RobotLed>
}

export type RuntimeLightingOptions = {
  now?: () => number
}

export type ManualLightingCommand =
  | {
      readonly kind: 'off'
      readonly index?: number
      readonly count?: number
    }
  | {
      readonly kind: 'on'
      readonly r: number
      readonly g: number
      readonly b: number
      readonly expiresAt?: number
      readonly index?: number
      readonly count?: number
    }
  | {
      readonly kind: 'blink'
      readonly r: number
      readonly g: number
      readonly b: number
      readonly duration: number
      readonly index?: number
      readonly count?: number
    }
  | {
      readonly kind: 'rainbow'
      readonly index?: number
      readonly count?: number
    }

export class StackchanRuntimeLighting {
  #led: Record<string, RobotLed>
  #manualCommands = new Map<string, ManualLightingCommand>()
  #now: () => number

  constructor(params: RuntimeLightingConstructorParam, options: RuntimeLightingOptions = {}) {
    this.#led = params.led ?? {}
    this.#now = options.now ?? (() => 0)
  }

  get led() {
    return this.#led
  }

  lightOn(ledName: string, r: number, g: number, b: number, duration?: number, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      this.#manualCommands.set(ledName, {
        kind: 'on',
        r,
        g,
        b,
        expiresAt: duration === undefined ? undefined : this.#now() + duration,
        index,
        count,
      })
      led.on(r, g, b, duration, index, count)
    }
  }

  lightOff(ledName: string, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      this.#manualCommands.set(ledName, { kind: 'off', index, count })
      led.off(index, count)
    }
  }

  lightBlink(ledName: string, r: number, g: number, b: number, duration: number, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      this.#manualCommands.set(ledName, { kind: 'blink', r, g, b, duration, index, count })
      led.blink(r, g, b, duration, index, count)
    }
  }

  lightRainbow(ledName: string, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      this.#manualCommands.set(ledName, { kind: 'rainbow', index, count })
      led.rainbow(index, count)
    }
  }

  snapshotManualCommand(ledName: string): ManualLightingCommand | undefined {
    return this.#manualCommands.get(ledName)
  }

  applyInteractionColor(ledName: string, r: number, g: number, b: number): void {
    this.#led[ledName]?.on(r, g, b)
  }

  restoreManualCommand(ledName: string, command: ManualLightingCommand | undefined): void {
    const led = this.#led[ledName]
    if (!led) return
    if (!command) {
      led.off()
      return
    }
    switch (command.kind) {
      case 'off':
        led.off(command.index, command.count)
        break
      case 'on':
        if (command.expiresAt !== undefined && command.expiresAt <= this.#now()) {
          led.off(command.index, command.count)
        } else {
          const duration = command.expiresAt === undefined ? undefined : Math.max(1, command.expiresAt - this.#now())
          led.on(command.r, command.g, command.b, duration, command.index, command.count)
        }
        break
      case 'blink':
        led.blink(command.r, command.g, command.b, command.duration, command.index, command.count)
        break
      case 'rainbow':
        led.rainbow(command.index, command.count)
        break
    }
  }

  close(): void {
    for (const led of Object.values(this.#led)) {
      try {
        led.off()
      } catch {
        // best-effort shutdown: keep turning off the remaining LEDs
      }
    }
    this.#manualCommands.clear()
  }
}
