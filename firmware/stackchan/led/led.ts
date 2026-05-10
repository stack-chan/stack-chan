import { NeoStrand, NeoStrandEffect, type NeoStrandEffectDictionary } from 'neostrand'
import Timer from 'timer'

const Timing_WS2812B = {
  mark: { level0: 1, duration0: 900, level1: 0, duration1: 350 },
  space: { level0: 1, duration0: 350, level1: 0, duration1: 900 },
  reset: { level0: 0, duration0: 100, level1: 0, duration1: 100 },
} as const

class Blink extends NeoStrandEffect {
  private light: boolean
  private rgbOn: number
  private rgbOff: number
  constructor(
    dictionary: NeoStrandEffectDictionary & {
      rgb: { r: number; g: number; b: number }
      index?: number
      count?: number
      duration?: number
    },
  ) {
    super(dictionary)
    this.name = 'Blink'
    this.loop = 1
    this.light = false

    if (dictionary.index) {
      this.start = dictionary.index
    }
    if (dictionary.count) {
      this.size = dictionary.count
      this.end = this.start + this.size
      if (this.end > this.strand.length) this.end = this.strand.length
    }
    this.dur = dictionary.duration ?? 1000
    this.rgbOn = this.strand.makeRGB(dictionary.rgb.r, dictionary.rgb.g, dictionary.rgb.b)
    this.rgbOff = this.strand.makeRGB(0, 0, 0)
  }

  activate(effect: NeoStrandEffect): void {
    effect.timeline.on(effect, { effectValue: [0, effect.dur] }, effect.dur, null, 0)
    effect.reset(effect)
  }

  set effectValue(value) {
    const isFirstHalf = value <= this.dur / 2
    const shouldTurnOn = !this.light && isFirstHalf
    const shouldTurnOff = this.light && !isFirstHalf

    if (shouldTurnOn || shouldTurnOff) {
      const color = shouldTurnOn ? this.rgbOn : this.rgbOff
      for (let i = this.start; i < this.end; i++) {
        this.strand.set(i, color)
      }
      this.light = shouldTurnOn
    }
  }
}

export default class Led extends NeoStrand {
  private _effect?: NeoStrandEffect
  private _offTimer?: Timer

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

  private _stopEffect() {
    if (this._effect) {
      this.stop()
      this._effect = undefined
    }
    if (this._offTimer) {
      Timer.clear(this._offTimer)
      this._offTimer = undefined
    }
  }

  on(r: number, g: number, b: number, duration?: number, index?: number, count?: number) {
    const _index = index ?? 0
    const _count = count ?? this.length - _index
    this._stopEffect()
    this._fill(this.makeRGB(r, g, b), _index, _count)

    this.update()
    if (duration) {
      this._offTimer = Timer.set(() => {
        this.off(_index, _count)
      }, duration)
    }
  }

  off(index?: number, count?: number) {
    const _index = index ?? 0
    const _count = count ?? this.length - _index
    this._stopEffect()
    this._fill(this.makeRGB(0, 0, 0), _index, _count)
    this.update()
  }

  blink(r: number, g: number, b: number, duration: number, index?: number, count?: number) {
    const _index = index ?? 0
    const _count = count ?? this.length - _index
    this._stopEffect()

    this._effect = new Blink({
      strand: this,
      rgb: { r, g, b },
      index: _index,
      count: _count,
      duration: duration,
    })
    this.setScheme([this._effect])
    this.start(100)
  }

  rainbow(index?: number, count?: number) {
    const _index = index ?? 0
    const _count = count ?? this.length - _index
    this._stopEffect()

    this._effect = new NeoStrand.HueSpan({ strand: this, start: _index, end: _index + _count })
    this.setScheme([this._effect])
    this.start(50)
  }
}
