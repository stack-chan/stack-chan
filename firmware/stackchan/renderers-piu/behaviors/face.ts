import { type Container as PiuContainer, type Content as PiuContent } from 'piu/MC'
import { copyFaceContext, createFaceContext, defaultFaceContext, type FaceContext } from 'face-context'
import { updateFaceSkinPalette, type FaceSkinPalette } from 'face-skin'
import { createBlinkMotion } from 'motions/blink'
import { createBreathMotion } from 'motions/breath'
import type { FaceMotion } from 'motions/types'
import { EyeSprite } from 'parts/image/eye-sprite'
import { MouthSprite } from 'parts/image/mouth-sprite'
import { DogEyebrow } from 'parts/dog/eyebrow'
import { DogMouth } from 'parts/dog/mouth'
import { DogNose } from 'parts/dog/nose'
import { Eye } from 'parts/eye'
import { Mouth } from 'parts/mouth'

type TemplateCtor<TData> = {
  new (behaviorData?: TData, dictionary?: Record<string, unknown>): PiuContainer
  template: (factory: unknown) => TemplateCtor<TData>
}

export type FaceBaseParams = {
  contents?: PiuContent[]
  motions?: FaceMotion[]
  intervalMs?: number
  left?: number
  top?: number
  right?: number
  bottom?: number
  width?: number
  height?: number
}

export type FaceTemplateCtor = TemplateCtor<unknown>

type FaceBehaviorOptions = {
  motions?: FaceMotion[]
  intervalMs?: number
}

export class FaceBehavior extends Behavior {
  #current: FaceContext
  #desired: FaceContext
  #motions: FaceMotion[]
  #baseCoordinates: { left: number; top: number } | null
  #paused: boolean
  #skinPalette: FaceSkinPalette | null
  #breathPixels: number

  constructor({ motions, intervalMs }: FaceBehaviorOptions) {
    super()
    this.#motions = motions ?? [
      createBlinkMotion({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
      createBreathMotion({ duration: 6000 }),
      // createSaccadeMotion({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
    ]
    this.#current = createFaceContext()
    this.#desired = createFaceContext()
    this.#baseCoordinates = null
    this.#paused = false
    this.#skinPalette = null
    this.#breathPixels = 6
    this.intervalMs = intervalMs ?? 33
  }

  intervalMs: number

  onCreate(container: PiuContainer) {
    container.interval = this.intervalMs
    copyFaceContext(defaultFaceContext, this.#desired)
    this.updateSkinPalette(container, defaultFaceContext)
    if (this.#skinPalette) {
      container.distribute('onFaceSkin', this.#skinPalette)
      container.bubble('onFaceSkin', this.#skinPalette)
    }
    container.distribute('onFaceContext', this.#current)
    // container.bubble('onFaceContext', this.#current)
  }

  onDisplaying(container: PiuContainer) {
    if (this.#baseCoordinates === null) {
      const coordinates = container.coordinates
      this.#baseCoordinates = {
        left: coordinates?.left ?? 0,
        top: coordinates?.top ?? 0,
      }
    }
    if (!this.#paused) {
      container.start?.()
    }
    if (this.#skinPalette) {
      container.distribute('onFaceSkin', this.#skinPalette)
      container.bubble('onFaceSkin', this.#skinPalette)
    }
    container.distribute('onFaceContext', this.#current)
    // container.bubble('onFaceContext', this.#current)
  }

  onFaceUpdate(_container: PiuContainer, face: FaceContext) {
    copyFaceContext(face, this.#desired)
  }

  onTimeChanged(container: PiuContainer) {
    if (this.#paused) {
      return
    }
    const interval = container.interval ?? this.intervalMs
    copyFaceContext(this.#desired, this.#current)
    for (const motion of this.#motions) {
      motion(interval, this.#current)
    }
    if (this.#baseCoordinates === null) {
      const coordinates = container.coordinates
      this.#baseCoordinates = {
        left: coordinates?.left ?? 0,
        top: coordinates?.top ?? 0,
      }
    }
    const base = this.#baseCoordinates ?? { left: 0, top: 0 }
    const nextY = base.top + this.#current.breath * this.#breathPixels
    container.coordinates = {
      ...(container.coordinates ?? {}),
      left: base.left,
      top: nextY,
    }
    const paletteChanged = this.updateSkinPalette(container, this.#current)
    if (paletteChanged && this.#skinPalette) {
      container.distribute('onFaceSkin', this.#skinPalette)
      container.bubble('onFaceSkin', this.#skinPalette)
    }
    container.distribute('onFaceContext', this.#current)
    // container.bubble('onFaceContext', this.#current)
  }

  onTouchEnded(container: PiuContainer) {
    container.bubble('onFaceTouch')
  }

  getBaseCoordinates(container: PiuContainer): { left: number; top: number } {
    if (this.#baseCoordinates === null) {
      const coordinates = container.coordinates
      this.#baseCoordinates = {
        left: coordinates?.left ?? 0,
        top: coordinates?.top ?? 0,
      }
    }
    return { ...this.#baseCoordinates }
  }

  pause(container: PiuContainer) {
    if (this.#paused) return
    this.#paused = true
    container.stop?.()
    container.visible = false
    container.active = false
  }

  resume(container: PiuContainer) {
    if (!this.#paused) return
    this.#paused = false
    container.visible = true
    container.active = true
    container.start?.()
    if (this.#skinPalette) {
      container.distribute('onFaceSkin', this.#skinPalette)
      container.bubble('onFaceSkin', this.#skinPalette)
    }
    container.distribute('onFaceContext', this.#current)
    container.bubble('onFaceContext', this.#current)
  }

  get breathPixels(): number {
    return this.#breathPixels
  }

  private updateSkinPalette(container: PiuContainer, face: Readonly<FaceContext>): boolean {
    const next = updateFaceSkinPalette(this.#skinPalette, face)
    const changed = next !== this.#skinPalette
    this.#skinPalette = next
    if (this.#skinPalette) {
      ;(container as PiuContainer & { faceSkin?: FaceSkinPalette }).faceSkin = this.#skinPalette
    }
    return changed
  }
}

const DEFAULT_FACE_LEFT = 60
const DEFAULT_FACE_TOP = 60
const DEFAULT_FACE_WIDTH = 200
const DEFAULT_FACE_HEIGHT = 120

function resolveFaceBaseParams(data: FaceBaseParams, it?: FaceBaseParams): FaceBaseParams {
  return {
    ...data,
    ...it,
    contents: it?.contents ?? data.contents,
  }
}

export const FaceBase: FaceTemplateCtor = Container.template(($: FaceBaseParams, it?: FaceBaseParams) => {
  const params = resolveFaceBaseParams($, it)
  const contents = params.contents ?? []
  if (it?.contents) {
    delete it.contents
  }
  return {
    left: params.left,
    right: params.right,
    top: params.top,
    bottom: params.bottom,
    width: params.width,
    height: params.height,
    // skin: new Skin({ fill: '#ff0000' }),
    active: true,
    contents,
    Behavior: class extends FaceBehavior {
      constructor() {
        super({
          motions: params.motions,
          intervalMs: params.intervalMs,
        })
      }
    },
  }
})

export const SimpleFace: FaceTemplateCtor = FaceBase.template(($: FaceBaseParams = {}) => {
  const left = $.left ?? DEFAULT_FACE_LEFT
  const top = $.top ?? DEFAULT_FACE_TOP
  const width = $.width ?? DEFAULT_FACE_WIDTH
  const height = $.height ?? DEFAULT_FACE_HEIGHT
  return {
    left,
    top,
    width,
    height,
    contents: [
      new Eye({ cx: 30, cy: 33, radius: 8, side: 'left' }),
      new Eye({ cx: 170, cy: 36, radius: 8, side: 'right' }),
      new Mouth({ cx: 100, cy: 88 }),
    ],
  }
})

export const SmallFace: FaceTemplateCtor = FaceBase.template(($: FaceBaseParams = {}) => {
  const left = $.left ?? DEFAULT_FACE_LEFT
  const top = $.top ?? DEFAULT_FACE_TOP
  const width = $.width ?? DEFAULT_FACE_WIDTH
  const height = $.height ?? DEFAULT_FACE_HEIGHT
  return {
    left,
    top,
    width,
    height,
    contents: [
      new Eye({ cx: 36, cy: 53, radius: 4, side: 'left' }),
      new Eye({ cx: 92, cy: 54, radius: 4, side: 'right' }),
      new Mouth({ cx: 64, cy: 80, minWidth: 20, maxWidth: 36, minHeight: 3, maxHeight: 23 }),
    ],
  }
})

export const DogFace: FaceTemplateCtor = FaceBase.template(($: FaceBaseParams = {}) => {
  const left = $.left ?? DEFAULT_FACE_LEFT
  const top = $.top ?? DEFAULT_FACE_TOP
  const width = $.width ?? DEFAULT_FACE_WIDTH
  const height = $.height ?? DEFAULT_FACE_HEIGHT
  const mouthCy = 136 - DEFAULT_FACE_TOP
  return {
    left,
    top,
    width,
    height,
    contents: [
      new Eye({ cx: 30, cy: 33, radius: 10, side: 'left', eyelidWidth: 24, eyelidHeight: 24 }),
      new Eye({ cx: 170, cy: 36, radius: 10, side: 'right', eyelidWidth: 24, eyelidHeight: 24 }),
      new DogEyebrow({
        cx: 30,
        cy: 33,
        side: 'left',
        canvasWidth: width,
        canvasHeight: height,
      }),
      new DogEyebrow({
        cx: 170,
        cy: 36,
        side: 'right',
        canvasWidth: width,
        canvasHeight: height,
      }),
      new DogMouth({
        cx: 100,
        cy: mouthCy,
        maxWidth: 70,
        maxHeight: 32,
        canvasWidth: width,
        canvasHeight: height,
      }),
      new DogNose({
        cx: 100,
        cy: mouthCy,
        canvasWidth: width,
        canvasHeight: height,
      }),
    ],
  }
})

export const ImageFace: FaceTemplateCtor = FaceBase.template(($: FaceBaseParams = {}) => {
  const left = $.left ?? DEFAULT_FACE_LEFT
  const top = $.top ?? DEFAULT_FACE_TOP
  const width = $.width ?? DEFAULT_FACE_WIDTH
  const height = $.height ?? DEFAULT_FACE_HEIGHT
  return {
    left,
    top,
    width,
    height,
    contents: [
      new EyeSprite({ cx: 30, cy: 33, side: 'left' }),
      new EyeSprite({ cx: 170, cy: 36, side: 'right' }),
      new MouthSprite({ cx: 100, cy: 88 }),
    ],
  }
})
