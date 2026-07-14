import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber, toPiuColorString } from 'face-state'
import { Container, type Port as PiuPort, type Texture as PiuTexture, Port, Texture } from 'piu/MC'

export type MusicNotesOptions = {
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
}

type StaticNoteOptions = {
  left?: number
  right?: number
  top: number
  variant: number
}

const SPRITE_SIZE = 32
const MUSIC_ROW = 4
const MUSIC_ROW_Y = MUSIC_ROW * SPRITE_SIZE
const LEFT_NOTE_X = 12
const RIGHT_NOTE_X = 12
const LEFT_NOTE_Y = 72
const RIGHT_NOTE_Y = 104

let texture: PiuTexture | undefined
let colorCache: Map<number, string> | undefined

function getTexture(): PiuTexture {
  texture ??= new Texture('emoticon.png')
  return texture
}

function colorString(color: number): string {
  colorCache ??= new Map()
  const cached = colorCache.get(color)
  if (cached) return cached
  const value = toPiuColorString(color)
  colorCache.set(color, value)
  return value
}

class StaticMusicNoteBehavior extends Behavior {
  #color = DEFAULT_FACE_PRIMARY_COLOR
  #hasPalette = false
  #variant = 2

  onCreate(_port: PiuPort, options: StaticNoteOptions) {
    this.#variant = options.variant
  }

  onDisplaying(port: PiuPort) {
    port.invalidate()
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

  onDraw(port: PiuPort) {
    port.fillColor('transparent', 0, 0, SPRITE_SIZE, SPRITE_SIZE)
    port.drawTexture(
      getTexture(),
      colorString(this.#color),
      0,
      0,
      this.#variant * SPRITE_SIZE,
      MUSIC_ROW_Y,
      SPRITE_SIZE,
      SPRITE_SIZE,
    )
  }
}

const StaticNote = Port.template((options: StaticNoteOptions) => ({
  left: options.left,
  right: options.right,
  top: options.top,
  width: SPRITE_SIZE,
  height: SPRITE_SIZE,
  Behavior: class extends StaticMusicNoteBehavior {
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
    new StaticNote({ left: LEFT_NOTE_X, top: LEFT_NOTE_Y, variant: 2 }),
    new StaticNote({ right: RIGHT_NOTE_X, top: RIGHT_NOTE_Y, variant: 1 }),
  ],
}))
