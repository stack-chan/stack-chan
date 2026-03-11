import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import type {} from 'piu/shape'
import { copyFaceContext, createFaceContext, defaultFaceContext, type FaceContext } from 'face-context'
import { createBlinkMotion } from 'motions/blink'
import { createBreathMotion } from 'motions/breath'
import { createSaccadeMotion } from 'motions/saccade'
import type { FaceMotion } from 'motions/types'
import { createEye } from 'parts/eye'
import { createEyelid } from 'parts/eyelid'
import { createMouth } from 'parts/mouth'
import { createDogEyebrow } from 'parts/dog/eyebrow'
import { createDogMouth } from 'parts/dog/mouth'
import { createDogNose } from 'parts/dog/nose'

export type FaceBounds = {
  left: number
  top: number
  width: number
  height: number
}

type FaceBehaviorOptions = {
  buildParts: () => PiuContent[]
  motions?: FaceMotion[]
  intervalMs?: number
  height?: number
  faceBounds?: FaceBounds
}

export type FaceContainerParams = {
  buildParts: () => PiuContent[]
  motions?: FaceMotion[]
  intervalMs?: number
  height?: number
  faceBounds?: FaceBounds
}

type FaceContainerTemplateCtor = {
  new (behaviorData?: unknown, dictionary?: FaceContainerParams): PiuContainer
}

export class FaceBehavior extends Behavior {
  #current: FaceContext
  #desired: FaceContext
  #motions: FaceMotion[]
  #baseCoordinates: { left: number; top: number } | null
  #paused: boolean
  #buildParts: () => PiuContent[]
  #height?: number
  #faceBounds?: FaceBounds

  constructor({ buildParts, motions, intervalMs, height, faceBounds }: FaceBehaviorOptions) {
    super()
    this.#buildParts = buildParts
    this.#motions = motions ?? [
      createBlinkMotion({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
      createBreathMotion({ duration: 6000 }),
      createSaccadeMotion({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
    ]
    this.#current = createFaceContext()
    this.#desired = createFaceContext()
    this.#baseCoordinates = null
    this.#paused = false
    this.intervalMs = intervalMs ?? 33
    this.#height = height
    this.#faceBounds = faceBounds
  }

  intervalMs: number

  onCreate(container: PiuContainer) {
    if (this.#faceBounds) {
      const { left, top, width, height } = this.#faceBounds
      container.coordinates = { ...(container.coordinates ?? {}), left, top }
      container.width = width
      container.height = height
    } else if (this.#height !== undefined) {
      container.height = this.#height
    }
    container.interval = this.intervalMs
    copyFaceContext(defaultFaceContext, this.#desired)
    this.rebuild(container)
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
    container.distribute('onFaceContext', this.#current)
    container.bubble('onFaceContext', this.#current)
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
    const nextY = base.top + this.#current.breath * 6
    container.coordinates = {
      ...(container.coordinates ?? {}),
      left: base.left,
      top: nextY,
    }
    container.distribute('onFaceContext', this.#current)
    container.bubble('onFaceContext', this.#current)
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
    container.distribute('onFaceContext', this.#current)
    container.bubble('onFaceContext', this.#current)
  }

  rebuild(container: PiuContainer) {
    container.empty()
    this.#baseCoordinates = null
    const parts = this.#buildParts()
    for (const part of parts) {
      container.add(part)
    }
    container.distribute('onFaceContext', this.#current)
    container.bubble('onFaceContext', this.#current)
  }
}

type FaceOffset = {
  x: number
  y: number
}

export const DEFAULT_FACE_BOUNDS: FaceBounds = { left: 60, top: 60, width: 200, height: 120 }
const DEFAULT_FACE_OFFSET: FaceOffset = { x: DEFAULT_FACE_BOUNDS.left, y: DEFAULT_FACE_BOUNDS.top }
const ZERO_FACE_OFFSET: FaceOffset = { x: 0, y: 0 }

function offsetPoint(cx: number, cy: number, offset: FaceOffset): { cx: number; cy: number } {
  return { cx: cx - offset.x, cy: cy - offset.y }
}

export function createSimpleFaceParts(offset: FaceOffset = DEFAULT_FACE_OFFSET): PiuContent[] {
  const leftEye = offsetPoint(90, 93, offset)
  const rightEye = offsetPoint(230, 96, offset)
  const leftLid = offsetPoint(90, 93, offset)
  const rightLid = offsetPoint(230, 96, offset)
  const mouth = offsetPoint(160, 148, offset)
  return [
    createEye({ ...leftEye, radius: 8, side: 'left' }),
    createEye({ ...rightEye, radius: 8, side: 'right' }),
    createEyelid({ ...leftLid, width: 24, height: 24, side: 'left' }),
    createEyelid({ ...rightLid, width: 24, height: 24, side: 'right' }),
    createMouth({ ...mouth }),
  ]
}

export function createSmallFaceParts(offset: FaceOffset = ZERO_FACE_OFFSET): PiuContent[] {
  const leftEye = offsetPoint(36, 53, offset)
  const rightEye = offsetPoint(92, 54, offset)
  const leftLid = offsetPoint(36, 53, offset)
  const rightLid = offsetPoint(92, 54, offset)
  const mouth = offsetPoint(64, 80, offset)
  return [
    createEye({ ...leftEye, radius: 4, side: 'left' }),
    createEye({ ...rightEye, radius: 4, side: 'right' }),
    createEyelid({ ...leftLid, width: 12, height: 12, side: 'left' }),
    createEyelid({ ...rightLid, width: 12, height: 12, side: 'right' }),
    createMouth({ ...mouth, minWidth: 20, maxWidth: 36, minHeight: 3, maxHeight: 23 }),
  ]
}

export function createDogFaceParts(
  offset: FaceOffset = DEFAULT_FACE_OFFSET,
  bounds: FaceBounds = DEFAULT_FACE_BOUNDS,
): PiuContent[] {
  const mouthCy = 136
  const leftEye = offsetPoint(90, 93, offset)
  const rightEye = offsetPoint(230, 96, offset)
  const leftLid = offsetPoint(90, 93, offset)
  const rightLid = offsetPoint(230, 96, offset)
  const leftBrow = offsetPoint(90, 93, offset)
  const rightBrow = offsetPoint(230, 96, offset)
  const mouth = offsetPoint(160, mouthCy, offset)
  return [
    createEye({ ...leftEye, radius: 10, side: 'left' }),
    createEye({ ...rightEye, radius: 10, side: 'right' }),
    createEyelid({ ...leftLid, width: 24, height: 24, side: 'left' }),
    createEyelid({ ...rightLid, width: 24, height: 24, side: 'right' }),
    createDogEyebrow({
      ...leftBrow,
      side: 'left',
      canvasWidth: bounds.width,
      canvasHeight: bounds.height,
    }),
    createDogEyebrow({
      ...rightBrow,
      side: 'right',
      canvasWidth: bounds.width,
      canvasHeight: bounds.height,
    }),
    createDogMouth({
      ...mouth,
      maxWidth: 70,
      maxHeight: 32,
      canvasWidth: bounds.width,
      canvasHeight: bounds.height,
    }),
    createDogNose({
      ...mouth,
      canvasWidth: bounds.width,
      canvasHeight: bounds.height,
    }),
  ]
}

export function createFaceContainer(
  buildParts: () => PiuContent[],
  motions?: FaceMotion[],
  intervalMs?: number,
  height?: number,
  faceBounds?: FaceBounds,
): PiuContainer {
  return new FaceContainerTemplate({ buildParts, motions, intervalMs, height, faceBounds })
}

// @ts-expect-error Moddable template typing does not model dictionary 'this' correctly
export const FaceContainerTemplate = Container.template<FaceContainerParams>(($) => {
  const bounds = $.faceBounds
  const left = bounds?.left ?? 0
  const top = bounds?.top ?? 0
  const width = bounds?.width
  const height = bounds?.height ?? $.height ?? 240
  const right = bounds ? undefined : 0
  return {
    left,
    right,
    top,
    width,
    height,
    active: true,
    contents: [],
    Behavior: class extends FaceBehavior {
      constructor() {
        super({
          buildParts: $.buildParts,
          motions: $.motions,
          intervalMs: $.intervalMs,
          height: $.height,
          faceBounds: $.faceBounds,
        })
      }
    },
  }
}) as unknown as FaceContainerTemplateCtor

export function createSimpleFaceContainer(motions?: FaceMotion[], intervalMs?: number): PiuContainer {
  return createFaceContainer(
    () => createSimpleFaceParts(DEFAULT_FACE_OFFSET),
    motions,
    intervalMs,
    DEFAULT_FACE_BOUNDS.height,
    DEFAULT_FACE_BOUNDS,
  )
}

export function createDogFaceContainer(motions?: FaceMotion[], intervalMs?: number): PiuContainer {
  return createFaceContainer(
    () => createDogFaceParts(DEFAULT_FACE_OFFSET, DEFAULT_FACE_BOUNDS),
    motions,
    intervalMs,
    DEFAULT_FACE_BOUNDS.height,
    DEFAULT_FACE_BOUNDS,
  )
}

export function createSmallFaceContainer(motions?: FaceMotion[], intervalMs?: number): PiuContainer {
  return createFaceContainer(createSmallFaceParts, motions, intervalMs, 120)
}
