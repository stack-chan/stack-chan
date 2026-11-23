import { EffectSprite, effectFrames } from 'effects/effect-sprites'
import { Container, type Container as PiuContainer, type Port as PiuPort, Port } from 'piu/MC'

export type MusicNotesOptions = {
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
}

type FloatingNoteOptions = {
  left?: number
  right?: number
  baseY: number
  phase: number
  frame: 'mintNote' | 'goldNote'
  drift: number
}

const PORT_WIDTH = 32
const RISE_PIXELS = 30
const NOTE_HEIGHT = 16 + RISE_PIXELS
const ANIMATION_INTERVAL_MS = 150
const FADE_DURATION_MS = 1200
const CYCLE_DURATION_MS = 1800

class FloatingMusicNoteBehavior extends Behavior {
  #sprite = new EffectSprite()
  #elapsed: number
  #frame: (typeof effectFrames)[FloatingNoteOptions['frame']]
  #drift: number
  #paused = false

  constructor(options: FloatingNoteOptions) {
    super()
    this.#elapsed = options.phase
    this.#frame = effectFrames[options.frame]
    this.#drift = options.drift
  }

  onDisplaying(port: PiuPort) {
    this.#update(port)
    if (!this.#paused) port.start()
  }

  onUndisplaying(port: PiuPort) {
    port.stop()
  }

  setPaused(port: PiuPort, paused: boolean): void {
    if (this.#paused === paused) return
    this.#paused = paused
    if (paused) {
      port.stop()
    } else if (port.application) {
      port.start()
    }
    this.#update(port)
  }

  onTimeChanged(port: PiuPort) {
    if (this.#paused) return
    this.#elapsed = (this.#elapsed + ANIMATION_INTERVAL_MS) % CYCLE_DURATION_MS
    this.#update(port)
  }

  onDraw(port: PiuPort) {
    this.#sprite.draw(port)
  }

  #update(port: PiuPort) {
    const center = PORT_WIDTH / 2
    if (this.#paused) {
      this.#sprite.place(port, this.#frame, center, NOTE_HEIGHT / 2)
    } else if (this.#elapsed >= FADE_DURATION_MS) {
      this.#sprite.hide(port)
    } else {
      const progress = this.#elapsed / FADE_DURATION_MS
      const rise = RISE_PIXELS * progress * (2 - progress)
      const x = center + this.#drift * progress
      const y = NOTE_HEIGHT - this.#frame[3] / 2 - rise
      const alpha = Math.round(255 * (1 - progress * progress))
      this.#sprite.place(port, this.#frame, x, y, alpha)
    }
  }
}

const FloatingNote = Port.template((options: FloatingNoteOptions) => ({
  left: options.left,
  right: options.right,
  top: options.baseY - RISE_PIXELS,
  width: PORT_WIDTH,
  height: NOTE_HEIGHT,
  interval: ANIMATION_INTERVAL_MS,
  Behavior: class extends FloatingMusicNoteBehavior {
    constructor() {
      super(options)
    }
  },
}))

class MusicNotesBehavior extends Behavior {
  #enabled = true

  setMotionsEnabled(container: PiuContainer, enabled: boolean): void {
    if (this.#enabled === enabled) return
    this.#enabled = enabled
    this.#syncChildren(container)
  }

  onDisplaying(container: PiuContainer): void {
    this.#syncChildren(container)
  }

  #syncChildren(container: PiuContainer): void {
    const paused = !this.#enabled
    let child = container.first
    while (child) {
      const behavior = child.behavior as FloatingMusicNoteBehavior | undefined
      if (behavior && typeof behavior.setPaused === 'function') {
        behavior.setPaused(child as PiuPort, paused)
      } else if (paused) {
        child.stop()
      } else if (container.application) {
        child.start()
      }
      child = child.next
    }
  }
}

export const MusicNotes = Container.template((options: MusicNotesOptions = {}) => ({
  left: options.left ?? 0,
  right: options.right ?? 0,
  top: options.top ?? 0,
  bottom: options.bottom ?? 0,
  width: options.width,
  height: options.height,
  active: false,
  Behavior: MusicNotesBehavior,
  contents: [
    new FloatingNote({ left: 12, baseY: 72, phase: 0, frame: 'mintNote', drift: 8 }),
    new FloatingNote({ right: 12, baseY: 104, phase: CYCLE_DURATION_MS / 2, frame: 'goldNote', drift: -8 }),
  ],
}))
