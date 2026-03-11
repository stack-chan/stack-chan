import type { Container as PiuContainer, Content as PiuContent, Skin as PiuSkin } from 'piu/MC'
import { Outline } from 'commodetto/outline'
import { defaultFaceContext, toColorString, type FaceContext } from 'face-context'

type EmoticonKey = 'heart' | 'angry' | 'sweat' | 'tear' | 'sleepy'

type WithSkin = PiuContent & { skin?: PiuSkin; fillOutline?: unknown; strokeOutline?: unknown }

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

type EmoticonOptions = {
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

function primaryColor(face?: Readonly<FaceContext>): string {
  const theme = face?.theme ?? defaultFaceContext.theme
  return toColorString(theme.primary ?? defaultFaceContext.theme.primary)
}
function secondaryColor(face?: Readonly<FaceContext>): string {
  const theme = face?.theme ?? defaultFaceContext.theme
  return toColorString(theme.secondary ?? defaultFaceContext.theme.secondary)
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
  shape: WithSkin
}

class SweatBehavior extends Behavior {
  width = 64
  height = 120
  count = 3
  interval = 33
  smallScale = 0.21
  holdScale = 0.36
  basePath: OutlinePath | null = null
  drops: Drop[] = []
  primary: string | null = null
  secondary: string | null = null
  onCreate(container: PiuContainer, data: EmoticonOptions = {}) {
    if (!this.basePath) {
      this.basePath = this.buildBasePath()
    }
    this.drops = []
    this.width = data.width ?? container.width ?? this.width
    this.height = data.height ?? container.height ?? this.height
    this.count = data.count ?? this.count
    this.interval = data.interval ?? this.interval
    this.smallScale = data.smallScale ?? this.smallScale
    this.holdScale = data.holdScale ?? this.holdScale
    for (let i = 0; i < this.count; i++) {
      const shape = new Shape(null, { left: 0, top: 0, width: this.width, height: this.height }) as WithSkin
      container.add(shape)
      this.drops.push(this.spawnDrop(shape, true))
    }
    container.interval = this.interval
  }
  onDisplaying(container: PiuContainer) {
    this.tick(0)
    container.start?.()
  }
  onUndisplaying(container: PiuContainer) {
    container.stop?.()
  }
  onTimeChanged(container: PiuContainer) {
    this.tick(container.interval ?? this.interval)
  }
  onFaceContext(_container: PiuContainer, face: FaceContext) {
    this.primary = primaryColor(face)
    this.secondary = secondaryColor(face)
  }
  tick(dt: number) {
    const primary = this.primary ?? '#fff'
    const secondary = this.secondary ?? '#000'
    for (const drop of this.drops) {
      drop.life += dt
      const t = drop.life / drop.maxLife
      let scale = t < 0.3 ? this.smallScale + (this.holdScale - this.smallScale) * (t / 0.3) : this.holdScale
      if (t > 0.85) {
        const k = 1 - (t - 0.85) / 0.15
        scale *= Math.max(0, k)
      }
      drop.y += drop.speed * (dt / 16.67)
      if (drop.y > this.height + 16) {
        this.respawn(drop)
        continue
      }
      if (!this.basePath) continue
      const filled = outline.fill(this.basePath).scale(scale, scale).translate(drop.x, drop.y)
      const stroked = outline.stroke(this.basePath, 2).scale(scale, scale).translate(drop.x, drop.y)
      drop.shape.fillOutline = filled
      drop.shape.strokeOutline = stroked
      drop.shape.skin = new Skin({ fill: secondary, stroke: primary })
    }
  }
  buildBasePath() {
    const path = new outline.CanvasPath()
    path.moveTo(0, -20)
    path.quadraticCurveTo(-6, -6, -10, 6)
    path.quadraticCurveTo(-12, 12, -12, 18)
    path.quadraticCurveTo(-12, 30, 0, 36)
    path.quadraticCurveTo(12, 30, 12, 18)
    path.quadraticCurveTo(12, 12, 10, 6)
    path.quadraticCurveTo(6, -6, 0, -20)
    path.closePath()
    return path
  }
  spawnDrop(shape: WithSkin, initial = false): Drop {
    const maxLife = 1700 + Math.random() * 1100
    const startOffset = initial ? Math.random() * maxLife : 0
    return {
      x: 6 + Math.random() * (this.width - 12),
      y: -20 - Math.random() * 20,
      speed: 0.55 + Math.random() * 0.45,
      life: startOffset,
      maxLife,
      shape,
    }
  }
  respawn(drop: Drop) {
    const maxLife = 1700 + Math.random() * 1100
    drop.x = 6 + Math.random() * (this.width - 12)
    drop.y = -20 - Math.random() * 20
    drop.speed = 0.55 + Math.random() * 0.45
    drop.life = 0
    drop.maxLife = maxLife
  }
}

class TearBehavior extends Behavior {
  width = 320
  height = 120
  lanes: [number, number][] | null = null
  count = 4
  interval = 33
  smallScale = 0.18
  holdScale = 0.28
  basePath: OutlinePath | null = null
  drops: Drop[] = []
  primary: string | null = null
  secondary: string | null = null
  onCreate(container: PiuContainer, data: EmoticonOptions = {}) {
    if (!this.basePath) {
      this.basePath = this.buildBasePath()
    }
    this.drops = []
    this.width = (data.width as number) ?? container.width ?? this.width
    this.height = (data.height as number) ?? container.height ?? this.height
    this.lanes = (data.lanes as [number, number][]) ?? null
    this.count = (data.count as number) ?? this.count
    this.interval = (data.interval as number) ?? this.interval
    this.smallScale = (data.smallScale as number) ?? this.smallScale
    this.holdScale = (data.holdScale as number) ?? this.holdScale
    for (let i = 0; i < this.count; i++) {
      const shape = new Shape(null, { left: 0, top: 0, width: this.width, height: this.height }) as WithSkin
      container.add(shape)
      this.drops.push(this.spawnDrop(shape, i, true))
    }
    container.interval = this.interval
  }
  onDisplaying(container: PiuContainer) {
    this.tick(0)
    container.start?.()
  }
  onUndisplaying(container: PiuContainer) {
    container.stop?.()
  }
  onTimeChanged(container: PiuContainer) {
    this.tick(container.interval ?? this.interval)
  }
  onFaceContext(_container: PiuContainer, face: FaceContext) {
    this.primary = primaryColor(face)
    this.secondary = secondaryColor(face)
  }
  tick(dt: number) {
    const primary = this.primary ?? '#fff'
    const secondary = this.secondary ?? '#000'
    for (const drop of this.drops) {
      drop.life += dt
      const t = drop.life / drop.maxLife
      let scale = t < 0.25 ? this.smallScale + (this.holdScale - this.smallScale) * (t / 0.25) : this.holdScale
      if (t > 0.75) {
        const k = 1 - (t - 0.75) / 0.25
        scale *= Math.max(0, k)
      }
      drop.y += drop.speed * (dt / 16.67)
      if (drop.y > this.height + 8) {
        this.respawn(drop)
        continue
      }
      if (!this.basePath) continue
      const filled = outline.fill(this.basePath).scale(scale, scale).translate(drop.x, drop.y)
      const stroked = outline.stroke(this.basePath, 2).scale(scale, scale).translate(drop.x, drop.y)
      drop.shape.fillOutline = filled
      drop.shape.strokeOutline = stroked
      drop.shape.skin = new Skin({ fill: secondary, stroke: primary })
    }
  }
  buildBasePath() {
    const path = new outline.CanvasPath()
    path.moveTo(0, -12)
    path.quadraticCurveTo(-4, -2, -7, 5)
    path.quadraticCurveTo(-8, 10, -8, 14)
    path.quadraticCurveTo(-8, 22, 0, 26)
    path.quadraticCurveTo(8, 22, 8, 14)
    path.quadraticCurveTo(8, 10, 7, 5)
    path.quadraticCurveTo(4, -2, 0, -12)
    path.closePath()
    return path
  }
  spawnDrop(shape: WithSkin, laneIndex = 0, initial = false): Drop {
    const lanes = this.count
    const laneWidth = this.width / lanes
    let min = laneWidth * laneIndex
    let max = laneWidth * (laneIndex + 1)
    if (this.lanes && this.lanes.length > 0) {
      const pair = this.lanes[laneIndex % this.lanes.length]
      if (Array.isArray(pair) && pair.length === 2) {
        min = pair[0]
        max = pair[1]
      }
    }
    const center = (min + max) / 2
    const jitter = (max - min) * 0.18
    const maxLife = 900 + Math.random() * 400
    const startOffset = initial ? Math.random() * maxLife : 0
    return {
      x: center + (Math.random() - 0.5) * jitter,
      y: -10 - Math.random() * 8,
      speed: 0.45 + Math.random() * 0.25,
      life: startOffset,
      maxLife,
      shape,
    }
  }
  respawn(drop: Drop) {
    const maxLife = 900 + Math.random() * 400
    const lanes = this.count
    const laneIndex = Math.floor(Math.random() * lanes)
    const laneWidth = this.width / lanes
    let min = laneWidth * laneIndex
    let max = laneWidth * (laneIndex + 1)
    if (this.lanes && this.lanes.length > 0) {
      const pair = this.lanes[laneIndex % this.lanes.length]
      if (Array.isArray(pair) && pair.length === 2) {
        min = pair[0]
        max = pair[1]
      }
    }
    const center = (min + max) / 2
    const jitter = (max - min) * 0.18
    drop.x = center + (Math.random() - 0.5) * jitter
    drop.y = -10 - Math.random() * 8
    drop.speed = 0.45 + Math.random() * 0.25
    drop.life = 0
    drop.maxLife = maxLife
  }
}

type Bubble = { x: number; y: number; vx: number; r: number; shape: WithSkin }

class SleepyBubbleBehavior extends Behavior {
  width = 48
  height = 64
  bubbles: Bubble[] = []
  primary: string | null = null
  secondary: string | null = null
  onCreate(container: PiuContainer, data: EmoticonOptions = {}) {
    this.width = data.width ?? container.width ?? this.width
    this.height = data.height ?? container.height ?? this.height
    this.bubbles = []
    for (let i = 0; i < 4; i++) {
      const shape = new Shape(null, { left: 0, top: 0, width: this.width, height: this.height }) as WithSkin
      this.bubbles.push({
        x: Math.random() * this.width,
        vx: 0,
        y: Math.random() * this.height,
        r: 4 + Math.random() * 3,
        shape,
      })
      container.add(shape)
    }
    container.interval = data.interval ?? 33
  }
  onTimeChanged(container: PiuContainer) {
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
    for (const b of this.bubbles) {
      const path = new outline.CanvasPath()
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
      path.arc(b.x, height - b.y, b.r, 0, 2 * Math.PI)
      b.shape.strokeOutline = outline.stroke(path, 2)
      b.shape.fillOutline = undefined
      b.shape.skin = new Skin({ fill: secondary, stroke: primary })
    }
  }
}

const Heart = Shape.template((opts: EmoticonOptions) => ({
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

const Angry = Shape.template((opts: EmoticonOptions) => ({
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

const Sweat = Container.template((opts: EmoticonOptions) => ({
  left: opts.left ?? 8,
  right: opts.right,
  top: opts.top ?? 10,
  bottom: opts.bottom,
  width: opts.width ?? 72,
  height: opts.height ?? 140,
  interval: opts.interval,
  count: opts.count,
  Behavior: class extends SweatBehavior {
    onCreate(container: PiuContainer) {
      super.onCreate(container, opts)
    }
  },
}))

const Tear = Container.template((opts: EmoticonOptions) => ({
  left: opts.left ?? 0,
  right: opts.right ?? 0,
  top: opts.top ?? 96,
  bottom: opts.bottom,
  height: opts.height ?? 120,
  Behavior: class extends TearBehavior {
    onCreate(container: PiuContainer) {
      const data: EmoticonOptions = {
        ...opts,
        lanes: [
          [80, 100],
          [220, 240],
        ],
        count: 4,
      }
      super.onCreate(container, data)
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

export function createEmoticonEffect(key: EmoticonKey, opts: EmoticonOptions = {}): PiuContent {
  switch (key) {
    case 'heart':
      return new Heart(opts)
    case 'angry':
      return new Angry(opts)
    case 'sweat':
      return new Sweat(opts)
    case 'tear':
      return new Tear(opts)
    case 'sleepy':
      return new Sleepy(opts)
    default:
      return new Heart(opts)
  }
}
