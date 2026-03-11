import type {
  Application as PiuApplication,
  Container as PiuContainer,
  Content as PiuContent,
  Skin as PiuSkin,
} from 'piu/MC'
import type {} from 'piu/shape'
import { copyFaceContext, createFaceContext, defaultFaceContext, toColorString, type FaceContext } from 'face-context'
import { createBlinkModifier, createBreathModifier, createSaccadeModifier, type FaceModifier } from 'modifiers'
import { createEye } from 'parts/eye'
import { createEyelid } from 'parts/eyelid'
import { createMouth } from 'parts/mouth'
import { createDogEyebrow } from 'parts/dog/eyebrow'
import { createDogMouth } from 'parts/dog/mouth'
import { createDogNose } from 'parts/dog/nose'

type FaceMode = 'simple' | 'dog' | 'small'

type FaceBehaviorOptions = {
  mode: FaceMode
  modifiers?: FaceModifier[]
  intervalMs?: number
  afterTick?: (tick: number, face: FaceContext) => void
}

function getApplication(): PiuApplication | undefined {
  return (globalThis as { application?: PiuApplication }).application
}

export class FaceBehavior extends Behavior {
  #current: FaceContext
  #desired: FaceContext
  #modifiers: FaceModifier[]
  #baseY: number | null
  #paused: boolean
  #mode: FaceMode
  #needsSync: boolean
  #afterTick?: (tick: number, face: FaceContext) => void

  constructor({ mode, modifiers, intervalMs, afterTick }: FaceBehaviorOptions) {
    super()
    this.#mode = mode
    this.#modifiers = modifiers ?? [
      createBlinkModifier({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
      createBreathModifier({ duration: 6000 }),
      createSaccadeModifier({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
    ]
    this.#afterTick = afterTick
    this.#current = createFaceContext()
    this.#desired = createFaceContext()
    this.#baseY = null
    this.#paused = false
    this.#needsSync = false
    this.intervalMs = intervalMs ?? 33
  }

  intervalMs: number

  onCreate(container: PiuContainer) {
    container.interval = this.intervalMs
    copyFaceContext(defaultFaceContext, this.#desired)
    this.rebuild(container)
  }

  onDisplaying(container: PiuContainer) {
    if (this.#baseY === null) {
      this.#baseY = container.y
    }
    if (!this.#paused) {
      container.start?.()
    }
    if (this.#needsSync) {
      getApplication()?.distribute?.('onFaceContext', this.#current)
      this.#needsSync = false
    }
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
    for (const mod of this.#modifiers) {
      mod(interval, this.#current)
    }
    if (this.#baseY === null) {
      this.#baseY = container.y
    }
    container.y = (this.#baseY ?? 0) + this.#current.breath * 6
    getApplication()?.distribute?.('onFaceContext', this.#current)
    this.#afterTick?.(interval, this.#current)
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
    const app = getApplication()
    if (app) {
      app.distribute?.('onFaceContext', this.#current)
    } else {
      this.#needsSync = true
    }
  }

  rebuild(container: PiuContainer) {
    container.empty()
    const parts = createFaceParts(this.#mode)
    for (const part of parts) {
      container.add(part)
    }
    container.skin = new Skin({ fill: toColorString(defaultFaceContext.theme.secondary) })
    const app = getApplication()
    if (app) {
      app.distribute?.('onFaceContext', this.#current)
    } else {
      this.#needsSync = true
    }
  }
}

function createSimpleFaceParts(): PiuContent[] {
  return [
    createEye({ cx: 90, cy: 93, radius: 8, side: 'left' }),
    createEye({ cx: 230, cy: 96, radius: 8, side: 'right' }),
    createEyelid({ cx: 90, cy: 93, width: 24, height: 24, side: 'left' }),
    createEyelid({ cx: 230, cy: 96, width: 24, height: 24, side: 'right' }),
    createMouth({ cx: 160, cy: 148 }),
  ]
}

function createSmallFaceParts(): PiuContent[] {
  return [
    createEye({ cx: 36, cy: 53, radius: 4, side: 'left' }),
    createEye({ cx: 92, cy: 54, radius: 4, side: 'right' }),
    createEyelid({ cx: 36, cy: 53, width: 12, height: 12, side: 'left' }),
    createEyelid({ cx: 92, cy: 54, width: 12, height: 12, side: 'right' }),
    createMouth({ cx: 64, cy: 80, minWidth: 20, maxWidth: 36, minHeight: 3, maxHeight: 23 }),
  ]
}

function createDogFaceParts(): PiuContent[] {
  const mouthCy = 136
  return [
    createEye({ cx: 90, cy: 93, radius: 10, side: 'left' }),
    createEye({ cx: 230, cy: 96, radius: 10, side: 'right' }),
    createEyelid({ cx: 90, cy: 93, width: 24, height: 24, side: 'left' }),
    createEyelid({ cx: 230, cy: 96, width: 24, height: 24, side: 'right' }),
    createDogEyebrow({ cx: 90, cy: 93, side: 'left' }),
    createDogEyebrow({ cx: 230, cy: 96, side: 'right' }),
    createDogMouth({ cx: 160, cy: mouthCy, maxWidth: 70, maxHeight: 32 }),
    createDogNose({ cx: 160, cy: mouthCy }),
  ]
}

function createFaceParts(mode: FaceMode): PiuContent[] {
  if (mode === 'dog') return createDogFaceParts()
  if (mode === 'small') return createSmallFaceParts()
  return createSimpleFaceParts()
}

export function createFaceContainer(
  mode: FaceMode,
  modifiers?: FaceModifier[],
  intervalMs?: number,
  afterTick?: (tick: number, face: FaceContext) => void,
): PiuContainer {
  return new Container(null, {
    left: 0,
    right: 0,
    top: 0,
    height: mode === 'small' ? 120 : 240,
    active: true,
    contents: [],
    Behavior: class extends FaceBehavior {
      constructor() {
        super({ mode, modifiers, intervalMs, afterTick })
      }
    },
  })
}
