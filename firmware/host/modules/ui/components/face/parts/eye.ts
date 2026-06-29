import type { FaceSkinPalette } from 'face-skin'
import {
  DEFAULT_FACE_PRIMARY_COLOR,
  DEFAULT_FACE_SECONDARY_COLOR,
  Emotion,
  type FaceEyeKey,
  type FaceState,
  toPiuColorNumber,
} from 'face-state'
import { EYELID_SPRITE, eyeOpenToVariant, IMAGE_FACE_TEXTURE_PATHS, IRIS_SPRITE } from 'parts/image/atlas'
import { type Port as PiuPort, type Skin as PiuSkin, Port, Skin } from 'piu/MC'

export type EyeOptions = {
  cx: number
  cy: number
  radius?: number
  side: FaceEyeKey
  eyelidWidth?: number
  eyelidHeight?: number
}

const CLEAR_COLOR = 'transparent'

function createIrisSkin(color: number): PiuSkin {
  return new Skin({
    texture: { path: IMAGE_FACE_TEXTURE_PATHS.iris },
    width: IRIS_SPRITE.width,
    height: IRIS_SPRITE.height,
    color,
  })
}

function createEyelidSkin(color: number): PiuSkin {
  return new Skin({
    texture: { path: IMAGE_FACE_TEXTURE_PATHS.eyelid },
    width: EYELID_SPRITE.width,
    height: EYELID_SPRITE.height,
    variants: EYELID_SPRITE.width,
    color,
  })
}

function drawOpenForEmotion(open: number, emotion: FaceState['emotion']) {
  switch (emotion) {
    case Emotion.HAPPY:
      return Math.min(open, 0.35)
    case Emotion.SLEEPY:
      return Math.min(open, 0.5)
    default:
      return open
  }
}

class EyeBehavior extends Behavior {
  #side: FaceEyeKey = 'left'
  #width = 24
  #height = 24
  #diameter = 16
  #eyelidWidth = 24
  #eyelidHeight = 24
  #lastOpen = -1
  #lastEmotion: FaceState['emotion'] | null = null
  #lastGazeX = 0
  #lastGazeY = 0
  #primaryColor = DEFAULT_FACE_PRIMARY_COLOR
  #secondaryColor = DEFAULT_FACE_SECONDARY_COLOR
  #hasPalette = false
  #irisSkin: PiuSkin = createIrisSkin(DEFAULT_FACE_PRIMARY_COLOR)
  #eyelidSkin: PiuSkin = createEyelidSkin(DEFAULT_FACE_SECONDARY_COLOR)

  onCreate(port: PiuPort, opts: EyeOptions) {
    this.#side = opts.side
    const radius = opts.radius ?? 8
    this.#diameter = radius * 2
    this.#eyelidWidth = opts.eyelidWidth ?? radius * 3
    this.#eyelidHeight = opts.eyelidHeight ?? radius * 3
    this.#width = port.width || Math.max(this.#diameter, this.#eyelidWidth)
    this.#height = port.height || Math.max(this.#diameter, this.#eyelidHeight)
  }

  onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
    this.#hasPalette = true
    this.#updateSkins(palette.primaryColor, palette.secondaryColor)
    port.invalidate()
  }

  onFaceState(port: PiuPort, face: FaceState) {
    const eye = face.eyes[this.#side]
    const open = eye.open
    const gazeX = (eye.gazeX ?? 0) * 2
    const gazeY = (eye.gazeY ?? 0) * 2
    const emotion = face.emotion
    let needsDraw = false
    if (!this.#hasPalette) {
      needsDraw = this.#updateSkins(toPiuColorNumber(face.theme.primary), toPiuColorNumber(face.theme.secondary))
    }
    if (
      open === this.#lastOpen &&
      gazeX === this.#lastGazeX &&
      gazeY === this.#lastGazeY &&
      emotion === this.#lastEmotion &&
      !needsDraw
    ) {
      return
    }
    this.#lastOpen = open
    this.#lastGazeX = gazeX
    this.#lastGazeY = gazeY
    this.#lastEmotion = emotion
    port.invalidate()
  }

  #updateSkins(primary: number, secondary: number) {
    if (primary === this.#primaryColor && secondary === this.#secondaryColor) return false
    this.#primaryColor = primary
    this.#secondaryColor = secondary
    this.#irisSkin = createIrisSkin(primary)
    this.#eyelidSkin = createEyelidSkin(secondary)
    return true
  }

  onDraw(port: PiuPort) {
    port.fillColor(CLEAR_COLOR, 0, 0, this.#width, this.#height)

    const irisLeft = (this.#width - this.#diameter) / 2 + this.#lastGazeX
    const irisTop = (this.#height - this.#diameter) / 2 + this.#lastGazeY
    port.drawSkin(
      this.#irisSkin,
      Math.round(irisLeft),
      Math.round(irisTop),
      Math.round(this.#diameter),
      Math.round(this.#diameter),
    )

    const open = drawOpenForEmotion(this.#lastOpen < 0 ? 1 : this.#lastOpen, this.#lastEmotion ?? Emotion.NEUTRAL)
    const variant = eyeOpenToVariant(open)
    port.drawSkin(
      this.#eyelidSkin,
      Math.round((this.#width - this.#eyelidWidth) / 2),
      Math.round((this.#height - this.#eyelidHeight) / 2),
      Math.round(this.#eyelidWidth),
      Math.round(this.#eyelidHeight),
      variant,
    )
  }
}

export const Eye = Port.template((opts: EyeOptions) => {
  const radius = opts.radius ?? 8
  const diameter = radius * 2
  const eyelidWidth = opts.eyelidWidth ?? radius * 3
  const eyelidHeight = opts.eyelidHeight ?? radius * 3
  const width = Math.max(diameter, eyelidWidth)
  const height = Math.max(diameter, eyelidHeight)
  return {
    left: opts.cx - width / 2,
    top: opts.cy - height / 2,
    width,
    height,
    Behavior: class extends EyeBehavior {
      onCreate(port: PiuPort) {
        super.onCreate(port, opts)
      }
    },
  }
})
