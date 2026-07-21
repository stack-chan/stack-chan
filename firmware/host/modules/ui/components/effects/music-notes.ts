import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import { Container, type Port as PiuPort, type Texture as PiuTexture, Port, Texture } from 'piu/MC'

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
  variant: number
}

const SPRITE_SIZE = 32
const RISE_PIXELS = 30
const NOTE_HEIGHT = SPRITE_SIZE + RISE_PIXELS
const ANIMATION_INTERVAL_MS = 150
const FADE_DURATION_MS = 1200
const CYCLE_DURATION_MS = 1800
const MUSIC_ROW = 4
const MUSIC_ROW_Y = MUSIC_ROW * SPRITE_SIZE
const LEFT_NOTE_X = 12
const RIGHT_NOTE_X = 12
const LEFT_NOTE_Y = 72
const RIGHT_NOTE_Y = 104

let texture: PiuTexture | undefined

function getTexture(): PiuTexture {
  texture ??= new Texture('emoticon.png')
  return texture
}

class FloatingMusicNoteBehavior extends Behavior {
  #color = DEFAULT_FACE_PRIMARY_COLOR
  #elapsed = 0
  #hasPalette = false
  #variant = 2

  onCreate(port: PiuPort, options: FloatingNoteOptions) {
    this.#elapsed = options.phase
    this.#variant = options.variant
    port.interval = ANIMATION_INTERVAL_MS
  }

  onDisplaying(port: PiuPort) {
    port.invalidate()
    port.start()
  }

  onUndisplaying(port: PiuPort) {
    port.stop()
  }

  onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
    this.#hasPalette = true
    if (this.#color === palette.primaryColor) return
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
    const wasVisible = this.#elapsed < FADE_DURATION_MS
    this.#elapsed += ANIMATION_INTERVAL_MS
    if (this.#elapsed >= CYCLE_DURATION_MS) this.#elapsed -= CYCLE_DURATION_MS
    if (wasVisible || this.#elapsed < FADE_DURATION_MS) port.invalidate()
  }

  onDraw(port: PiuPort) {
    port.fillColor('transparent', 0, 0, SPRITE_SIZE, NOTE_HEIGHT)
    if (this.#elapsed >= FADE_DURATION_MS) return
    const progress = this.#elapsed / FADE_DURATION_MS
    const rise = Math.round(RISE_PIXELS * progress * (2 - progress))
    const alpha = Math.round(255 * (1 - progress))
    port.drawTexture(
      getTexture(),
      (this.#color * 256 + alpha) >>> 0,
      0,
      RISE_PIXELS - rise,
      this.#variant * SPRITE_SIZE,
      MUSIC_ROW_Y,
      SPRITE_SIZE,
      SPRITE_SIZE,
    )
  }
}

const FloatingNote = Port.template((options: FloatingNoteOptions) => ({
  left: options.left,
  right: options.right,
  top: options.baseY - RISE_PIXELS,
  width: SPRITE_SIZE,
  height: NOTE_HEIGHT,
  Behavior: class extends FloatingMusicNoteBehavior {
    onCreate(port: PiuPort) {
      super.onCreate(port, options)
    }
  },
}))

export const MusicNotes = Container.template((options: MusicNotesOptions = {}) => ({
  left: options.left ?? 0,
  right: options.right ?? 0,
  top: options.top ?? 0,
  bottom: options.bottom ?? 0,
  width: options.width,
  height: options.height,
  active: false,
  contents: [
    new FloatingNote({ left: LEFT_NOTE_X, baseY: LEFT_NOTE_Y, phase: 0, variant: 2 }),
    new FloatingNote({ right: RIGHT_NOTE_X, baseY: RIGHT_NOTE_Y, phase: CYCLE_DURATION_MS / 2, variant: 1 }),
  ],
}))
