import { NeoStrand, type NeoStrandEffect } from 'neostrand'
import Timer from 'timer'

const Timing_WS2812B = {
  mark: { level0: 1, duration0: 900, level1: 0, duration1: 350 },
  space: { level0: 1, duration0: 350, level1: 0, duration1: 900 },
  reset: { level0: 0, duration0: 100, level1: 0, duration1: 100 },
} as const

export default class Led extends NeoStrand {
  private _blinkTimer?: Timer
  private _blinking: boolean = false
  private _blinkState: boolean = false
  private _effect?: NeoStrandEffect

  constructor(parameters: {
    pin: number
    length?: number
    order?: string
  }) {
    super({
      pin: parameters.pin,
      length: parameters.length ?? 1,
      order: parameters.order ?? 'GRB',
      timing: Timing_WS2812B,
    })
  }
  private _fill(color: number, index: number, count: number) {
    for (let i = index; i < index + count; i++) {
      this.set(i, color)
    }
  }

  on(r: number, g: number, b: number, duration?: number, index?: number, count?: number) {
    const _index = index ?? 0
    const _count = count ?? this.length - _index
    this._fill(this.makeRGB(r, g, b), _index, _count)

    this.update()
    if (duration) {
      Timer.set(() => {
        this._fill(this.makeRGB(0, 0, 0), _index, _count)
        this.update()
      }, duration)
    }
  }
  off(index?: number, count?: number) {
    const _index = index ?? 0
    const _count = count ?? this.length - _index
    this._blinking = false
    if (this._blinkTimer !== undefined) {
      Timer.clear(this._blinkTimer)
      this._blinkTimer = undefined
    }
    if (this._effect) {
      this.stop()
      this._effect = undefined
    }
    this._fill(this.makeRGB(0, 0, 0), _index, _count)
    this.update()
  }

  blink(r: number, g: number, b: number, interval: number, index?: number, count?: number) {
    const _index = index ?? 0
    const _count = count ?? this.length - _index
    if (this._blinking) return
    this._blinking = true
    this._blinkState = false

    const step = () => {
      if (!this._blinking) return
      this._blinkState = !this._blinkState
      if (this._blinkState) {
        this._fill(this.makeRGB(r, g, b), _index, _count)
      } else {
        this._fill(this.makeRGB(0, 0, 0), _index, _count)
      }
      this.update()
    }
    this._blinkTimer = Timer.repeat(step, interval)
  }
  rainbow(index?: number, count?: number) {
    const _index = index ?? 0
    const _count = count ?? this.length - _index
    if (this._effect) return

    this._effect = new NeoStrand.HueSpan({ strand: this, start: _index, end: _count })
    this.setScheme([this._effect])
    this.start(50)
  }
}
