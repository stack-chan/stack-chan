import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber, toPiuColorString } from 'face-state'
import { type Port as PiuPort, Port } from 'piu/MC'

type Particle = { x: number; y: number; speed: number; phase: number; life: number; maxLife: number; kind: number }
export type MusicNotesOptions = {
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
  interval?: number
}

const PARTICLE_COUNT = 5
const TWO_PI = Math.PI * 2

function reset(particle: Particle, index: number, width: number, height: number): void {
  particle.x = Math.round(width * (0.12 + ((index * 0.19) % 0.76)))
  particle.y = height + 12 + index * 17
  particle.speed = 0.32 + (index % 3) * 0.08
  particle.phase = index * 1.31
  particle.life = 0
  particle.maxLife = 2400 + index * 260
  particle.kind = index % 2
}

class MusicNotesBehavior extends Behavior {
  #particles: Particle[] = []
  #width = 320
  #height = 180
  #color = DEFAULT_FACE_PRIMARY_COLOR
  #hasPalette = false

  onCreate(port: PiuPort, options: MusicNotesOptions = {}) {
    this.#width = options.width ?? port.width ?? this.#width
    this.#height = options.height ?? port.height ?? this.#height
    port.interval = options.interval ?? 33
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const particle = { x: 0, y: 0, speed: 0, phase: 0, life: 0, maxLife: 0, kind: 0 }
      reset(particle, index, this.#width, this.#height)
      particle.life = index * 310
      this.#particles.push(particle)
    }
  }

  onDisplaying(port: PiuPort) {
    port.start()
  }

  onUndisplaying(port: PiuPort) {
    port.stop()
  }

  onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
    this.#hasPalette = true
    this.#color = palette.primaryColor
    port.invalidate()
  }

  onFaceState(port: PiuPort, face: FaceState) {
    if (this.#hasPalette) return
    const color = toPiuColorNumber(face.theme.primary)
    if (color === this.#color) return
    this.#color = color
    port.invalidate()
  }

  onTimeChanged(port: PiuPort) {
    const interval = port.interval ?? 33
    for (let index = 0; index < this.#particles.length; index += 1) {
      const particle = this.#particles[index]
      particle.life += interval
      particle.y -= particle.speed * interval
      particle.phase += interval * 0.002
      if (particle.y < -20 || particle.life >= particle.maxLife) reset(particle, index, this.#width, this.#height)
    }
    port.invalidate()
  }

  onDraw(port: PiuPort) {
    port.fillColor('transparent', 0, 0, this.#width, this.#height)
    const color = toPiuColorString(this.#color)
    for (const particle of this.#particles) {
      const progress = particle.life / particle.maxLife
      const scale = progress < 0.2 ? 0.55 + progress * 2.25 : progress > 0.8 ? 1 - (progress - 0.8) * 2.25 : 1
      const unit = Math.max(1, Math.round(3 * scale))
      const x = Math.round(particle.x + Math.sin(particle.phase * TWO_PI) * 10)
      const y = Math.round(particle.y)
      port.fillColor(color, x + unit * 2, y, unit, unit * 5)
      port.fillColor(color, x + unit * 3, y, unit * 3, unit)
      if (particle.kind) port.fillColor(color, x + unit * 5, y, unit, unit * 4)
      port.fillColor(color, x, y + unit * 4, unit * 3, unit * 2)
      if (particle.kind) port.fillColor(color, x + unit * 3, y + unit * 3, unit * 3, unit * 2)
    }
  }
}

export const MusicNotes = Port.template((options: MusicNotesOptions = {}) => ({
  left: options.left ?? 0,
  right: options.right ?? 0,
  top: options.top ?? 0,
  bottom: options.bottom ?? 0,
  width: options.width,
  height: options.height,
  Behavior: class extends MusicNotesBehavior {
    onCreate(port: PiuPort) {
      super.onCreate(port, options)
    }
  },
}))
