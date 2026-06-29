import { Outline } from 'commodetto/outline'
import { defaultFaceContext, type FaceContext } from 'face-context'
import type { Container as PiuContainer, Content as PiuContent, Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export type EmoticonKey = 'heart' | 'angry' | 'sweat' | 'tear' | 'sleepy'

type WithSkin = PiuContent &
  Omit<PiuShape, 'fillOutline' | 'strokeOutline'> & {
    skin?: PiuSkin
    fillOutline?: unknown
    strokeOutline?: unknown
  }

type OutlinePath = {
  moveTo(x: number, y: number): void
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  arc?(x: number, y: number, radius: number, start: number, end: number): void
}

type OutlineOutline = {
  clone(): OutlineOutline
  scale(sx: number, sy: number): OutlineOutline
  rotate(angle: number): OutlineOutline
  translate(x: number, y: number): OutlineOutline
}

type OutlineModule = {
  CanvasPath: new () => OutlinePath
  fill(path: OutlinePath): OutlineOutline
  stroke(path: OutlinePath, width?: number): OutlineOutline
}

const outline: OutlineModule = Outline as unknown as OutlineModule

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

function primaryColor(face?: Readonly<FaceContext>): string {
  return face?.theme?.primary ?? defaultFaceContext.theme.primary
}
function secondaryColor(face?: Readonly<FaceContext>): string {
  return face?.theme?.secondary ?? defaultFaceContext.theme.secondary
}

class HeartBehavior extends Behavior {
  angle = 0.1
  xScale = 1
  yScale = 1
  fraction = 0
  primary: string | null = null
  baseOutline: OutlineOutline | null = null
  onCreate(shape: WithSkin, data: EmoticonOptions = {}) {
    this.angle = data.angle ?? 0.1
    this.xScale = (data.width ?? shape.width ?? 40) / 40
    this.yScale = (data.height ?? shape.height ?? 40) / 40
    this.baseOutline = this.buildBaseOutline()
    shape.interval = data.interval ?? 33
    this.updateSkin(shape, defaultFaceContext)
  }
  onDisplaying(shape: WithSkin) {
    this.applyOutline(shape)
    shape.start()
  }
  onUndisplaying(shape: WithSkin) {
    shape.stop()
  }
  onTimeChanged(shape: WithSkin) {
    this.fraction += (2 * Math.PI) / 100
    this.applyOutline(shape)
  }
  onFaceContext(shape: WithSkin, face: FaceContext) {
    this.updateSkin(shape, face)
  }
  buildBaseOutline() {
    const path = new outline.CanvasPath()
    path.moveTo(20, 13)
    path.bezierCurveTo(18, 8, 14, 5, 10, 5)
    path.bezierCurveTo(8, 5, 0, 5, 0, 15)
    path.bezierCurveTo(0, 30, 18, 35, 20, 40)
    path.bezierCurveTo(22, 35, 40, 30, 40, 15)
    path.bezierCurveTo(40, 5, 32, 5, 30, 5)
    path.bezierCurveTo(26, 5, 22, 8, 20, 13)
    return outline.fill(path)
  }
  applyOutline(shape: WithSkin) {
    if (!this.baseOutline) return
    const scale = Math.abs(Math.sin(this.fraction)) / 4 + 0.75
    const o = this.baseOutline.clone().scale(scale * this.xScale, scale * this.yScale)
    o.translate(-20, -20)
    o.rotate(this.angle)
    o.translate(20, 20)
    shape.fillOutline = o
    shape.strokeOutline = undefined
  }
  updateSkin(shape: WithSkin, face?: FaceContext) {
    const color = primaryColor(face)
    if (color === this.primary) return
    this.primary = color
    shape.skin = new Skin({ fill: color, stroke: color })
  }
}

class AngryBehavior extends Behavior {
  angle = 0.1
  xScale = 1
  yScale = 1
  fraction = 0
  primary: string | null = null
  baseOutline: OutlineOutline | null = null
  onCreate(shape: WithSkin, data: EmoticonOptions = {}) {
    this.angle = data.angle ?? 0.1
    this.xScale = (data.width ?? shape.width ?? 40) / 40
    this.yScale = (data.height ?? shape.height ?? 40) / 40
    this.baseOutline = this.buildBaseOutline()
    shape.interval = data.interval ?? 33
    this.updateSkin(shape, defaultFaceContext)
  }
  onDisplaying(shape: WithSkin) {
    this.applyOutline(shape)
    shape.start()
  }
  onUndisplaying(shape: WithSkin) {
    shape.stop()
  }
  onTimeChanged(shape: WithSkin) {
    this.fraction += (2 * Math.PI) / 100
    this.applyOutline(shape)
  }
  onFaceContext(shape: WithSkin, face: FaceContext) {
    this.updateSkin(shape, face)
  }
  buildBaseOutline() {
    const path = new outline.CanvasPath()
    path.moveTo(15, 5)
    path.quadraticCurveTo(20, 20, 5, 15)
    path.moveTo(25, 5)
    path.quadraticCurveTo(20, 20, 35, 15)
    path.moveTo(5, 25)
    path.quadraticCurveTo(20, 20, 15, 35)
    path.moveTo(25, 35)
    path.quadraticCurveTo(20, 20, 35, 25)
    return outline.stroke(path, 2)
  }
  applyOutline(shape: WithSkin) {
    if (!this.baseOutline) return
    const scale = Math.abs(Math.sin(this.fraction)) / 4 + 0.75
    shape.strokeOutline = this.baseOutline
      .clone()
      .scale(scale * this.xScale, scale * this.yScale)
      .rotate(this.angle)
    shape.fillOutline = undefined
  }
  updateSkin(shape: WithSkin, face?: FaceContext) {
    const color = primaryColor(face)
    if (color === this.primary) return
    this.primary = color
    shape.skin = new Skin({ fill: color, stroke: color })
  }
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

class SweatBehavior extends Behavior {
  width = 64
  height = 90
  count = 2
  interval = 33
  smallScale = 0.26
  holdScale = 0.3
  minScale = 0.24
  scaleSmoothing = 0.2
  drops: Drop[] = []
  laneXs: number[] = []
  drawCount = 0
  primary: string | null = null
  secondary: string | null = null
  onCreate(shape: WithSkin, data: EmoticonOptions = {}) {
    this.drops = []
    this.width = data.width ?? shape.width ?? this.width
    this.height = data.height ?? shape.height ?? this.height
    this.count = Math.max(1, Math.min(2, data.count ?? this.count))
    this.interval = data.interval ?? this.interval
    this.smallScale = data.smallScale ?? this.smallScale
    this.holdScale = data.holdScale ?? this.holdScale
    this.minScale = Math.max(this.minScale, this.smallScale * 0.9)
    this.laneXs = this.buildLaneXs()
    this.drawCount = 0
    for (let i = 0; i < this.count; i++) {
      this.drops.push(this.spawnDrop(i, true))
    }
    shape.interval = this.interval
  }
  onDisplaying(shape: WithSkin) {
    this.tick(shape, 0)
    shape.start()
  }
  onUndisplaying(shape: WithSkin) {
    shape.stop()
  }
  onTimeChanged(shape: WithSkin) {
    this.tick(shape, shape.interval ?? this.interval)
  }
  onFaceContext(shape: WithSkin, face: FaceContext) {
    this.primary = primaryColor(face)
    this.secondary = secondaryColor(face)
    shape.skin = new Skin({ fill: this.secondary ?? '#000', stroke: this.primary ?? '#fff' })
  }
  tick(shape: WithSkin, dt: number) {
    const primary = this.primary ?? '#fff'
    const secondary = this.secondary ?? '#000'
    const path = new outline.CanvasPath()
    let drawn = 0
    for (const drop of this.drops) {
      drop.life += dt
      const t = drop.life / drop.maxLife
      let targetScale = t < 0.3 ? this.smallScale + (this.holdScale - this.smallScale) * (t / 0.3) : this.holdScale
      if (t > 0.85) {
        const k = 1 - (t - 0.85) / 0.15
        targetScale *= Math.max(0, k)
      }
      targetScale = Math.max(this.minScale, targetScale)
      drop.scale += (targetScale - drop.scale) * this.scaleSmoothing
      const scale = drop.scale
      drop.y += drop.speed * (dt / 16.67)
      if (drop.y > this.height + 16) {
        this.respawn(drop)
        continue
      }
      this.appendDropPath(path, drop.x, drop.y, scale)
      drawn += 1
    }
    this.drawCount = drawn
    if (drawn > 0) {
      shape.strokeOutline = outline.stroke(path, 2)
      shape.fillOutline = undefined
    } else {
      shape.strokeOutline = undefined
      shape.fillOutline = undefined
    }
    shape.skin = new Skin({ fill: secondary, stroke: primary })
  }
  appendDropPath(path: OutlinePath, x: number, y: number, scale: number) {
    const sx = scale
    const sy = scale
    path.moveTo(x + 0 * sx, y + -20 * sy)
    path.quadraticCurveTo(x + -6 * sx, y + -6 * sy, x + -10 * sx, y + 6 * sy)
    path.quadraticCurveTo(x + -12 * sx, y + 12 * sy, x + -12 * sx, y + 18 * sy)
    path.quadraticCurveTo(x + -12 * sx, y + 30 * sy, x + 0 * sx, y + 36 * sy)
    path.quadraticCurveTo(x + 12 * sx, y + 30 * sy, x + 12 * sx, y + 18 * sy)
    path.quadraticCurveTo(x + 12 * sx, y + 12 * sy, x + 10 * sx, y + 6 * sy)
    path.quadraticCurveTo(x + 6 * sx, y + -6 * sy, x + 0 * sx, y + -20 * sy)
    path.closePath()
  }
  buildLaneXs() {
    if (this.count <= 1) return [this.width * 0.5]
    return [this.width * 0.3, this.width * 0.7]
  }
  spawnDrop(laneIndex = 0, initial = false): Drop {
    const maxLife = 1700 + Math.random() * 1100
    const baseOffset = (maxLife / this.count) * (laneIndex % this.count)
    const startOffset = initial ? baseOffset + Math.random() * (maxLife * 0.05) : 0
    const laneX = this.laneXs[laneIndex % this.laneXs.length] ?? this.width * 0.5
    const jitter = this.width * 0.06
    const scale = Math.max(this.minScale, this.holdScale)
    return {
      x: laneX + (Math.random() - 0.5) * jitter,
      y: -20 - Math.random() * 20,
      speed: 0.55 + Math.random() * 0.35 + (laneIndex % this.count) * 0.05,
      life: startOffset,
      maxLife,
      scale,
      laneIndex,
    }
  }
  respawn(drop: Drop) {
    const maxLife = 1700 + Math.random() * 1100
    const laneIndex = drop.laneIndex % this.count
    const laneX = this.laneXs[laneIndex % this.laneXs.length] ?? this.width * 0.5
    const jitter = this.width * 0.06
    drop.x = laneX + (Math.random() - 0.5) * jitter
    drop.y = -20 - Math.random() * 20
    drop.speed = 0.55 + Math.random() * 0.35 + laneIndex * 0.05
    drop.life = 0
    drop.maxLife = maxLife
    drop.scale = Math.max(this.minScale, this.holdScale)
  }
}

class TearBehavior extends Behavior {
  width = 200
  height = 60
  count = 2
  interval = 33
  smallScale = 0.33
  holdScale = 0.39
  minScale = 0.3
  scaleSmoothing = 0.2
  drops: Drop[] = []
  laneXs: number[] = []
  tickCount = 0
  primary: string | null = null
  secondary: string | null = null
  onCreate(shape: WithSkin, data: EmoticonOptions = {}) {
    this.drops = []
    this.width = (data.width as number) ?? shape.width ?? this.width
    this.height = (data.height as number) ?? shape.height ?? this.height
    this.count = Math.max(1, Math.min(2, (data.count as number) ?? this.count))
    this.interval = (data.interval as number) ?? this.interval
    this.smallScale = (data.smallScale as number) ?? this.smallScale
    this.holdScale = (data.holdScale as number) ?? this.holdScale
    this.minScale = Math.max(this.minScale, this.smallScale * 0.9)
    this.laneXs = this.buildLaneXs()
    for (let i = 0; i < this.count; i++) this.drops.push(this.spawnDrop(i, true))
    shape.interval = this.interval
    this.tickCount = 0
  }
  onDisplaying(shape: WithSkin) {
    this.tick(shape, 0)
    shape.start()
  }
  onUndisplaying(shape: WithSkin) {
    shape.stop()
  }
  onTimeChanged(shape: WithSkin) {
    this.tick(shape, shape.interval ?? this.interval)
  }
  onFaceContext(shape: WithSkin, face: FaceContext) {
    this.primary = primaryColor(face)
    this.secondary = secondaryColor(face)
    shape.skin = new Skin({ fill: this.secondary ?? '#000', stroke: this.primary ?? '#fff' })
  }
  tick(shape: WithSkin, dt: number) {
    const primary = this.primary ?? '#fff'
    const secondary = this.secondary ?? '#000'
    const path = new outline.CanvasPath()
    this.tickCount += 1
    let drawn = 0
    for (const drop of this.drops) {
      drop.life += dt
      const t = drop.life / drop.maxLife
      let targetScale = t < 0.25 ? this.smallScale + (this.holdScale - this.smallScale) * (t / 0.25) : this.holdScale
      if (t > 0.75) {
        const k = 1 - (t - 0.75) / 0.25
        targetScale *= Math.max(0, k)
      }
      if (!Number.isFinite(targetScale) || !Number.isFinite(drop.x) || !Number.isFinite(drop.y)) {
        this.respawn(drop)
        continue
      }
      targetScale = Math.max(this.minScale, targetScale)
      drop.scale += (targetScale - drop.scale) * this.scaleSmoothing
      const scale = drop.scale
      drop.y += drop.speed * (dt / 16.67)
      if (drop.y > this.height + 8) {
        this.respawn(drop)
        continue
      }
      this.appendDropPath(path, drop.x, drop.y, scale)
      drawn += 1
    }
    if (drawn > 0) {
      shape.strokeOutline = outline.stroke(path, 2)
      shape.fillOutline = undefined
    } else {
      shape.strokeOutline = undefined
      shape.fillOutline = undefined
    }
    shape.skin = new Skin({ fill: secondary, stroke: primary })
  }
  buildLaneXs() {
    if (this.count <= 1) return [this.width * 0.5]
    return [this.width * 0.15, this.width * 0.85]
  }
  appendDropPath(path: OutlinePath, x: number, y: number, scale: number) {
    const sx = scale
    const sy = scale
    path.moveTo(x + 0 * sx, y + -12 * sy)
    path.quadraticCurveTo(x + -4 * sx, y + -2 * sy, x + -7 * sx, y + 5 * sy)
    path.quadraticCurveTo(x + -8 * sx, y + 10 * sy, x + -8 * sx, y + 14 * sy)
    path.quadraticCurveTo(x + -8 * sx, y + 22 * sy, x + 0 * sx, y + 26 * sy)
    path.quadraticCurveTo(x + 8 * sx, y + 22 * sy, x + 8 * sx, y + 14 * sy)
    path.quadraticCurveTo(x + 8 * sx, y + 10 * sy, x + 7 * sx, y + 5 * sy)
    path.quadraticCurveTo(x + 4 * sx, y + -2 * sy, x + 0 * sx, y + -12 * sy)
    path.closePath()
  }
  spawnDrop(laneIndex = 0, initial = false): Drop {
    const laneX = this.laneXs[laneIndex % this.laneXs.length] ?? this.width * 0.5
    const jitter = this.width * 0.04
    const maxLife = 900 + Math.random() * 400
    const baseOffset = (maxLife / this.count) * (laneIndex % this.count)
    const startOffset = initial ? baseOffset + Math.random() * (maxLife * 0.05) : 0
    const scale = Math.max(this.minScale, this.holdScale)
    return {
      x: laneX + (Math.random() - 0.5) * jitter,
      y: -10 - Math.random() * 8,
      speed: 0.45 + Math.random() * 0.2 + (laneIndex % this.count) * 0.04,
      life: startOffset,
      maxLife,
      scale,
      laneIndex,
    }
  }
  respawn(drop: Drop) {
    const maxLife = 900 + Math.random() * 400
    const laneIndex = drop.laneIndex % this.count
    const laneX = this.laneXs[laneIndex % this.laneXs.length] ?? this.width * 0.5
    const jitter = this.width * 0.04
    drop.x = laneX + (Math.random() - 0.5) * jitter
    drop.y = -10 - Math.random() * 8
    drop.speed = 0.45 + Math.random() * 0.2 + laneIndex * 0.04
    drop.life = 0
    drop.maxLife = maxLife
    drop.scale = Math.max(this.minScale, this.holdScale)
  }
}

type Bubble = { x: number; y: number; vx: number; r: number }

class SleepyBubbleBehavior extends Behavior {
  width = 48
  height = 64
  count = 4
  bubbles: Bubble[] = []
  shape: WithSkin | null = null
  primary: string | null = null
  secondary: string | null = null
  onCreate(container: PiuContainer, data: EmoticonOptions = {}) {
    this.width = data.width ?? container.width ?? this.width
    this.height = data.height ?? container.height ?? this.height
    this.count = data.count ?? this.count
    this.bubbles = []
    this.shape = new Shape(null, { left: 0, top: 0, width: this.width, height: this.height }) as WithSkin
    container.add(this.shape)
    for (let i = 0; i < this.count; i++) {
      this.bubbles.push({
        x: Math.random() * this.width,
        vx: 0,
        y: Math.random() * this.height,
        r: 4 + Math.random() * 3,
      })
    }
    container.interval = data.interval ?? 33
  }
  onTimeChanged(_container: PiuContainer) {
    this.tick()
  }
  onDisplaying(container: PiuContainer) {
    this.tick()
    container.start?.()
  }
  onUndisplaying(container: PiuContainer) {
    container.stop?.()
  }
  onFaceContext(_container: PiuContainer, face: FaceContext) {
    this.primary = primaryColor(face)
    this.secondary = secondaryColor(face)
  }
  tick() {
    const width = this.width
    const height = this.height
    const primary = this.primary ?? '#fff'
    const secondary = this.secondary ?? '#000'
    const shape = this.shape
    if (!shape) return
    const path = new outline.CanvasPath()
    for (const b of this.bubbles) {
      const upwardSpeed = 1 - b.r / 12
      b.vx = b.vx * 0.85 + 0.1 * (Math.random() - 0.5)
      b.x += b.vx
      b.x = Math.max(b.r, Math.min(width - b.r, b.x))
      b.y = b.y + upwardSpeed * 2
      if (b.y > height - b.r) {
        b.y = b.r
        b.x = width * (1 - Math.random() * 0.2)
        b.vx = -3
      }
      b.r = Math.max(3, Math.min(12, b.r + 0.2 * (Math.random() - 0.5)))
      const cy = height - b.y
      if (path.arc) {
        path.moveTo(b.x + b.r, cy)
        path.arc(b.x, cy, b.r, 0, 2 * Math.PI)
        path.closePath()
      }
    }
    shape.strokeOutline = outline.stroke(path, 2)
    shape.fillOutline = undefined
    shape.skin = new Skin({ fill: secondary, stroke: primary })
  }
}

const Heart = defineShapeTemplate((opts: EmoticonOptions) => ({
  left: opts.left ?? 12,
  right: opts.right,
  top: opts.top ?? 12,
  bottom: opts.bottom,
  width: opts.width ?? 40,
  height: opts.height ?? 40,
  Behavior: class extends HeartBehavior {
    onCreate(shape: WithSkin) {
      super.onCreate(shape, opts)
    }
  },
}))

const Angry = defineShapeTemplate((opts: EmoticonOptions) => ({
  left: opts.left ?? 12,
  right: opts.right,
  top: opts.top ?? 12,
  bottom: opts.bottom,
  width: opts.width ?? 40,
  height: opts.height ?? 40,
  Behavior: class extends AngryBehavior {
    onCreate(shape: WithSkin) {
      super.onCreate(shape, opts)
    }
  },
}))

const Sweat = defineShapeTemplate((opts: EmoticonOptions) => ({
  left: opts.left ?? 8,
  right: opts.right,
  top: opts.top ?? 10,
  bottom: opts.bottom,
  width: opts.width ?? 72,
  height: opts.height ?? 100,
  Behavior: class extends SweatBehavior {
    onCreate(shape: WithSkin) {
      super.onCreate(shape, opts)
    }
  },
}))

const Tear = defineShapeTemplate((opts: EmoticonOptions) => ({
  left: opts.left ?? 60,
  right: opts.right,
  top: opts.top ?? 96,
  bottom: opts.bottom,
  width: opts.width ?? 200,
  height: opts.height ?? 60,
  Behavior: class extends TearBehavior {
    onCreate(shape: WithSkin) {
      super.onCreate(shape, opts)
    }
  },
}))

const Sleepy = Container.template((opts: EmoticonOptions) => ({
  left: opts.left ?? 16,
  right: opts.right,
  top: opts.top ?? 8,
  bottom: opts.bottom,
  width: opts.width ?? 48,
  height: opts.height ?? 64,
  Behavior: class extends SleepyBubbleBehavior {
    onCreate(container: PiuContainer) {
      super.onCreate(container, opts)
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
