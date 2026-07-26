import { SPRITE_PULSE_FRAME_COUNT, spritePulseVariantForFraction } from 'effects/emoticon-pulse'
import { DEFAULT_FACE_PRIMARY_COLOR, DEFAULT_FACE_SECONDARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import {
  Container,
  type Content as PiuContent,
  type Port as PiuPort,
  type Texture as PiuTexture,
  Port,
  Texture,
} from 'piu/MC'

export type EmoticonKey = 'heart' | 'angry' | 'sweat' | 'tear' | 'sleepy'

export type EmoticonOptions = {
  name?: string
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
  angle?: number
  interval?: number
  count?: number
  lanes?: [number, number][]
  smallScale?: number
  holdScale?: number
}

export type EmoticonParams = EmoticonOptions & {
  key: EmoticonKey
}

type Drop = {
  x: number
  y: number
  speed: number
  life: number
  maxLife: number
  scale: number
  laneIndex: number
}

type Bubble = {
  x: number
  y: number
  vx: number
  r: number
}

type DropConfig = {
  width: number
  height: number
  count: number
  interval: number
  smallScale: number
  holdScale: number
  minScale: number
  scaleSmoothing: number
  laneRatios: readonly [number, number]
  jitterRatio: number
  spawnY: number
  spawnRange: number
  despawnMargin: number
  maxLifeBase: number
  maxLifeJitter: number
  speedBase: number
  speedJitter: number
  laneSpeedStep: number
  fadeInRatio: number
  fadeOutRatio: number
}

const SPRITE_CELL_SIZE = 32
const SPRITE_FRAME_COUNT = SPRITE_PULSE_FRAME_COUNT
const HEART_ROW = 0
const ANGRY_ROW = 1
const DROP_ROW = 2
const BUBBLE_ROW = 3

const SWEAT_CONFIG: DropConfig = Object.freeze({
  width: 72,
  height: 100,
  count: 2,
  interval: 33,
  smallScale: 0.26,
  holdScale: 0.3,
  minScale: 0.24,
  scaleSmoothing: 0.2,
  laneRatios: Object.freeze([0.3, 0.7]),
  jitterRatio: 0.06,
  spawnY: -20,
  spawnRange: 20,
  despawnMargin: 16,
  maxLifeBase: 1700,
  maxLifeJitter: 1100,
  speedBase: 0.55,
  speedJitter: 0.35,
  laneSpeedStep: 0.05,
  fadeInRatio: 0.3,
  fadeOutRatio: 0.85,
})

const TEAR_CONFIG: DropConfig = Object.freeze({
  width: 200,
  height: 60,
  count: 2,
  interval: 33,
  smallScale: 0.33,
  holdScale: 0.39,
  minScale: 0.3,
  scaleSmoothing: 0.2,
  laneRatios: Object.freeze([0.15, 0.85]),
  jitterRatio: 0.04,
  spawnY: -10,
  spawnRange: 8,
  despawnMargin: 8,
  maxLifeBase: 900,
  maxLifeJitter: 400,
  speedBase: 0.45,
  speedJitter: 0.2,
  laneSpeedStep: 0.04,
  fadeInRatio: 0.25,
  fadeOutRatio: 0.75,
})

let emoticonTexture: PiuTexture | null = null

function getEmoticonTexture() {
  if (!emoticonTexture) emoticonTexture = new Texture('emoticon.png')
  return emoticonTexture
}

function primaryColor(face?: FaceState): number {
  return face ? toPiuColorNumber(face.theme.primary) : DEFAULT_FACE_PRIMARY_COLOR
}

function secondaryColor(face?: FaceState): number {
  return face ? toPiuColorNumber(face.theme.secondary) : DEFAULT_FACE_SECONDARY_COLOR
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function centeredSpriteX(width: number) {
  return Math.round((width - SPRITE_CELL_SIZE) / 2)
}

function centeredSpriteY(height: number) {
  return Math.round((height - SPRITE_CELL_SIZE) / 2)
}

function spriteVariantForScale(scale: number, minScale: number, holdScale: number) {
  const normalized = (scale - minScale) / Math.max(0.01, holdScale - minScale)
  return clamp(Math.round(normalized * (SPRITE_FRAME_COUNT - 1)), 0, SPRITE_FRAME_COUNT - 1)
}

function drawSpriteCell(port: PiuPort, row: number, variant: number, color: number, x: number, y: number) {
  const frame = clamp(variant, 0, SPRITE_FRAME_COUNT - 1)
  port.drawTexture(
    getEmoticonTexture(),
    ((color << 8) | 0xff) >>> 0,
    Math.round(x),
    Math.round(y),
    frame * SPRITE_CELL_SIZE,
    row * SPRITE_CELL_SIZE,
    SPRITE_CELL_SIZE,
    SPRITE_CELL_SIZE,
  )
}

function intersectsCell(
  dirtyX: number,
  dirtyY: number,
  dirtyWidth: number,
  dirtyHeight: number,
  cellX: number,
  cellY: number,
): boolean {
  return (
    dirtyX < cellX + SPRITE_CELL_SIZE &&
    dirtyX + dirtyWidth > cellX &&
    dirtyY < cellY + SPRITE_CELL_SIZE &&
    dirtyY + dirtyHeight > cellY
  )
}

class SpritePulseBehavior extends Behavior {
  #row = HEART_ROW
  #width = 40
  #height = 40
  #interval = 33
  #fraction = 0
  #primary = primaryColor()
  #variant = spritePulseVariantForFraction(0)

  onCreate(port: PiuPort, data: EmoticonOptions = {}, row = HEART_ROW) {
    this.#row = row
    this.#width = data.width ?? port.width ?? this.#width
    this.#height = data.height ?? port.height ?? this.#height
    this.#interval = data.interval ?? this.#interval
    port.interval = this.#interval
  }

  onDisplaying(port: PiuPort) {
    this.#invalidateSprite(port)
    port.start()
  }

  onUndisplaying(port: PiuPort) {
    port.stop()
  }

  onTimeChanged(port: PiuPort) {
    this.#fraction += (2 * Math.PI) / 100
    const nextVariant = spritePulseVariantForFraction(this.#fraction)
    if (nextVariant === this.#variant) return
    this.#variant = nextVariant
    this.#invalidateSprite(port)
  }

  onFaceState(port: PiuPort, face: FaceState) {
    const nextPrimary = primaryColor(face)
    if (nextPrimary === this.#primary) return
    this.#primary = nextPrimary
    this.#invalidateSprite(port)
  }

  onDraw(port: PiuPort, x = 0, y = 0, width = this.#width, height = this.#height) {
    const spriteX = centeredSpriteX(this.#width)
    const spriteY = centeredSpriteY(this.#height)
    if (!intersectsCell(x, y, width, height, spriteX, spriteY)) return
    drawSpriteCell(port, this.#row, this.#variant, this.#primary, spriteX, spriteY)
  }

  #invalidateSprite(port: PiuPort) {
    port.invalidate(centeredSpriteX(this.#width), centeredSpriteY(this.#height), SPRITE_CELL_SIZE, SPRITE_CELL_SIZE)
  }
}

class DropBehavior extends Behavior {
  #config = SWEAT_CONFIG
  #width = SWEAT_CONFIG.width
  #height = SWEAT_CONFIG.height
  #count = SWEAT_CONFIG.count
  #interval = SWEAT_CONFIG.interval
  #smallScale = SWEAT_CONFIG.smallScale
  #holdScale = SWEAT_CONFIG.holdScale
  #minScale = SWEAT_CONFIG.minScale
  #scaleSmoothing = SWEAT_CONFIG.scaleSmoothing
  #drops: Drop[] = []
  #laneXs: number[] = []
  #primary = primaryColor()

  onCreate(port: PiuPort, data: EmoticonOptions = {}, config = SWEAT_CONFIG) {
    this.#config = config
    this.#width = data.width ?? port.width ?? config.width
    this.#height = data.height ?? port.height ?? config.height
    this.#count = clamp(data.count ?? config.count, 1, 2)
    this.#interval = data.interval ?? config.interval
    this.#smallScale = data.smallScale ?? config.smallScale
    this.#holdScale = data.holdScale ?? config.holdScale
    this.#minScale = Math.max(config.minScale, this.#smallScale * 0.9)
    this.#scaleSmoothing = config.scaleSmoothing
    this.#laneXs = this.#buildLaneXs()
    this.#drops = []
    for (let i = 0; i < this.#count; i++) {
      this.#drops.push(this.#spawnDrop(i, true))
    }
    port.interval = this.#interval
  }

  onDisplaying(port: PiuPort) {
    this.#advance(0)
    this.#invalidateDrops(port)
    port.start()
  }

  onUndisplaying(port: PiuPort) {
    port.stop()
  }

  onTimeChanged(port: PiuPort) {
    this.#invalidateDrops(port)
    this.#advance(port.interval ?? this.#interval)
    this.#invalidateDrops(port)
  }

  onFaceState(port: PiuPort, face: FaceState) {
    const nextPrimary = primaryColor(face)
    if (nextPrimary === this.#primary) return
    this.#primary = nextPrimary
    this.#invalidateDrops(port)
  }

  onDraw(port: PiuPort, x = 0, y = 0, width = this.#width, height = this.#height) {
    for (const drop of this.#drops) {
      const spriteX = Math.round(drop.x - SPRITE_CELL_SIZE / 2)
      const spriteY = Math.round(drop.y - SPRITE_CELL_SIZE / 2)
      if (!intersectsCell(x, y, width, height, spriteX, spriteY)) continue
      const variant = spriteVariantForScale(drop.scale, this.#minScale, this.#holdScale)
      drawSpriteCell(port, DROP_ROW, variant, this.#primary, spriteX, spriteY)
    }
  }

  #invalidateDrops(port: PiuPort) {
    for (const drop of this.#drops) {
      port.invalidate(
        Math.round(drop.x - SPRITE_CELL_SIZE / 2),
        Math.round(drop.y - SPRITE_CELL_SIZE / 2),
        SPRITE_CELL_SIZE,
        SPRITE_CELL_SIZE,
      )
    }
  }

  #advance(dt: number) {
    for (const drop of this.#drops) {
      drop.life += dt
      const t = drop.life / drop.maxLife
      let targetScale =
        t < this.#config.fadeInRatio
          ? this.#smallScale + (this.#holdScale - this.#smallScale) * (t / this.#config.fadeInRatio)
          : this.#holdScale
      if (t > this.#config.fadeOutRatio) {
        const k = 1 - (t - this.#config.fadeOutRatio) / (1 - this.#config.fadeOutRatio)
        targetScale *= Math.max(0, k)
      }
      if (!Number.isFinite(targetScale) || !Number.isFinite(drop.x) || !Number.isFinite(drop.y)) {
        this.#respawn(drop)
        continue
      }
      targetScale = Math.max(this.#minScale, targetScale)
      drop.scale += (targetScale - drop.scale) * this.#scaleSmoothing
      drop.y += drop.speed * (dt / 16.67)
      if (drop.y > this.#height + this.#config.despawnMargin) this.#respawn(drop)
    }
  }

  #buildLaneXs() {
    if (this.#count <= 1) return [this.#width * 0.5]
    return [this.#width * this.#config.laneRatios[0], this.#width * this.#config.laneRatios[1]]
  }

  #spawnDrop(laneIndex = 0, initial = false): Drop {
    const maxLife = this.#config.maxLifeBase + Math.random() * this.#config.maxLifeJitter
    const baseOffset = (maxLife / this.#count) * (laneIndex % this.#count)
    const startOffset = initial ? baseOffset + Math.random() * (maxLife * 0.05) : 0
    const laneX = this.#laneXs[laneIndex % this.#laneXs.length] ?? this.#width * 0.5
    const jitter = this.#width * this.#config.jitterRatio
    return {
      x: laneX + (Math.random() - 0.5) * jitter,
      y: this.#config.spawnY - Math.random() * this.#config.spawnRange,
      speed:
        this.#config.speedBase +
        Math.random() * this.#config.speedJitter +
        (laneIndex % this.#count) * this.#config.laneSpeedStep,
      life: startOffset,
      maxLife,
      scale: Math.max(this.#minScale, this.#holdScale),
      laneIndex,
    }
  }

  #respawn(drop: Drop) {
    const laneIndex = drop.laneIndex % this.#count
    const laneX = this.#laneXs[laneIndex % this.#laneXs.length] ?? this.#width * 0.5
    const jitter = this.#width * this.#config.jitterRatio
    drop.x = laneX + (Math.random() - 0.5) * jitter
    drop.y = this.#config.spawnY - Math.random() * this.#config.spawnRange
    drop.speed =
      this.#config.speedBase + Math.random() * this.#config.speedJitter + laneIndex * this.#config.laneSpeedStep
    drop.life = 0
    drop.maxLife = this.#config.maxLifeBase + Math.random() * this.#config.maxLifeJitter
    drop.scale = Math.max(this.#minScale, this.#holdScale)
  }
}

class SleepyBubbleBehavior extends Behavior {
  #width = 48
  #height = 64
  #count = 4
  #interval = 33
  #bubbles: Bubble[] = []
  #primary = primaryColor()
  #secondary = secondaryColor()

  onCreate(port: PiuPort, data: EmoticonOptions = {}) {
    this.#width = data.width ?? port.width ?? this.#width
    this.#height = data.height ?? port.height ?? this.#height
    this.#count = data.count ?? this.#count
    this.#interval = data.interval ?? this.#interval
    this.#bubbles = []
    for (let i = 0; i < this.#count; i++) {
      this.#bubbles.push({
        x: Math.random() * this.#width,
        vx: 0,
        y: Math.random() * this.#height,
        r: 4 + Math.random() * 3,
      })
    }
    port.interval = this.#interval
  }

  onDisplaying(port: PiuPort) {
    this.#advance()
    this.#invalidateBubbles(port)
    port.start()
  }

  onUndisplaying(port: PiuPort) {
    port.stop()
  }

  onTimeChanged(port: PiuPort) {
    this.#invalidateBubbles(port)
    this.#advance()
    this.#invalidateBubbles(port)
  }

  onFaceState(port: PiuPort, face: FaceState) {
    const nextPrimary = primaryColor(face)
    const nextSecondary = secondaryColor(face)
    if (nextPrimary === this.#primary && nextSecondary === this.#secondary) return
    this.#primary = nextPrimary
    this.#secondary = nextSecondary
    this.#invalidateBubbles(port)
  }

  onDraw(port: PiuPort, x = 0, y = 0, width = this.#width, height = this.#height) {
    for (const bubble of this.#bubbles) {
      const variant = clamp(Math.round((bubble.r - 3) / 3), 0, SPRITE_FRAME_COUNT - 1)
      const cy = this.#height - bubble.y
      const spriteX = Math.round(bubble.x - SPRITE_CELL_SIZE / 2)
      const spriteY = Math.round(cy - SPRITE_CELL_SIZE / 2)
      if (!intersectsCell(x, y, width, height, spriteX, spriteY)) continue
      drawSpriteCell(port, BUBBLE_ROW, variant, this.#primary, spriteX, spriteY)
    }
  }

  #invalidateBubbles(port: PiuPort) {
    for (const bubble of this.#bubbles) {
      const cy = this.#height - bubble.y
      port.invalidate(
        Math.round(bubble.x - SPRITE_CELL_SIZE / 2),
        Math.round(cy - SPRITE_CELL_SIZE / 2),
        SPRITE_CELL_SIZE,
        SPRITE_CELL_SIZE,
      )
    }
  }

  #advance() {
    for (const bubble of this.#bubbles) {
      const upwardSpeed = 1 - bubble.r / 12
      bubble.vx = bubble.vx * 0.85 + 0.1 * (Math.random() - 0.5)
      bubble.x += bubble.vx
      bubble.x = clamp(bubble.x, bubble.r, this.#width - bubble.r)
      bubble.y += upwardSpeed * 2
      if (bubble.y > this.#height - bubble.r) {
        bubble.y = bubble.r
        bubble.x = this.#width * (1 - Math.random() * 0.2)
        bubble.vx = -3
      }
      bubble.r = clamp(bubble.r + 0.2 * (Math.random() - 0.5), 3, 12)
    }
  }
}

const Heart = Port.template((opts: EmoticonOptions) => ({
  left: opts.left ?? 12,
  right: opts.right,
  top: opts.top ?? 12,
  bottom: opts.bottom,
  width: opts.width ?? 40,
  height: opts.height ?? 40,
  Behavior: class extends SpritePulseBehavior {
    onCreate(port: PiuPort) {
      super.onCreate(port, opts, HEART_ROW)
    }
  },
}))

const Angry = Port.template((opts: EmoticonOptions) => ({
  left: opts.left ?? 12,
  right: opts.right,
  top: opts.top ?? 12,
  bottom: opts.bottom,
  width: opts.width ?? 40,
  height: opts.height ?? 40,
  Behavior: class extends SpritePulseBehavior {
    onCreate(port: PiuPort) {
      super.onCreate(port, opts, ANGRY_ROW)
    }
  },
}))

const Sweat = Port.template((opts: EmoticonOptions) => ({
  left: opts.left ?? 8,
  right: opts.right,
  top: opts.top ?? 10,
  bottom: opts.bottom,
  width: opts.width ?? SWEAT_CONFIG.width,
  height: opts.height ?? SWEAT_CONFIG.height,
  Behavior: class extends DropBehavior {
    onCreate(port: PiuPort) {
      super.onCreate(port, opts, SWEAT_CONFIG)
    }
  },
}))

const Tear = Port.template((opts: EmoticonOptions) => ({
  left: opts.left ?? 60,
  right: opts.right,
  top: opts.top ?? 96,
  bottom: opts.bottom,
  width: opts.width ?? TEAR_CONFIG.width,
  height: opts.height ?? TEAR_CONFIG.height,
  Behavior: class extends DropBehavior {
    onCreate(port: PiuPort) {
      super.onCreate(port, opts, TEAR_CONFIG)
    }
  },
}))

const Sleepy = Port.template((opts: EmoticonOptions) => ({
  left: opts.left ?? 16,
  right: opts.right,
  top: opts.top ?? 8,
  bottom: opts.bottom,
  width: opts.width ?? 48,
  height: opts.height ?? 64,
  Behavior: class extends SleepyBubbleBehavior {
    onCreate(port: PiuPort) {
      super.onCreate(port, opts)
    }
  },
}))

export const Emoticon = Container.template((opts: EmoticonParams) => {
  const data = opts ?? { key: 'heart' }
  const key = data.key
  const name = data.name ?? `Emoticon:${key}`
  let content: PiuContent
  switch (key) {
    case 'heart':
      content = new Heart(data)
      break
    case 'angry':
      content = new Angry(data)
      break
    case 'sweat':
      content = new Sweat(data)
      break
    case 'tear':
      content = new Tear(data)
      break
    case 'sleepy':
      content = new Sleepy(data)
      break
    default:
      content = new Heart(data)
      break
  }
  return {
    name,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    clip: false,
    active: false,
    contents: [content],
  }
})
