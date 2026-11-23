import { EffectSprite, effectFrames, type SpriteFrame } from 'effects/effect-sprites'
import { Container, type Container as PiuContainer, type Port as PiuPort, Port } from 'piu/MC'

export type EmoticonKey = 'heart' | 'angry' | 'sweat' | 'tear' | 'sleepy' | 'gloom'

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

type EffectLayout = {
  left: number
  top: number
  width: number
  height: number
}

type PoseAnimation = EffectLayout & {
  kind: 'pose'
  frame: SpriteFrame
  rebound?: SpriteFrame
  x: Int8Array
  y: Int8Array
  useRebound?: Uint8Array
}

type DropAnimation = EffectLayout & {
  kind: 'drop'
  frames: readonly [small: SpriteFrame, falling: SpriteFrame, splash: SpriteFrame]
  lanes: readonly [number, number]
  duration: number
  smallScale: number
  holdScale: number
  minScale: number
}

type BubbleAnimation = EffectLayout & {
  kind: 'bubble'
  duration: number
}

const POSE_DURATION = 64
const ANIMATION_INTERVAL = 48

const heart: PoseAnimation = {
  kind: 'pose',
  left: 12,
  top: 12,
  width: 40,
  height: 40,
  frame: effectFrames.heart,
  rebound: effectFrames.heartSquash,
  x: Int8Array.of(-4, -3, -1, 2, 3, 4, 5, 5, 4, 3, 2, 0, -1, -3, -4, -4, -4, -4),
  y: Int8Array.of(4, 1, -3, -6, -7, -5, -2, 1, 2, -2, -4, -3, 0, 3, 4, 4, 4, 4),
  useRebound: Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1),
}

const angry: PoseAnimation = {
  kind: 'pose',
  left: 12,
  top: 12,
  width: 40,
  height: 40,
  frame: effectFrames.angry,
  rebound: effectFrames.angryRebound,
  x: Int8Array.of(-3, 0, 4, 1, 4, 1, 3, 1, 1, 1, 1, 0, -2),
  y: Int8Array.of(2, -4, -6, -3, -3, -1, -1, 0, 0, 0, 0, 1, 1),
  useRebound: Uint8Array.of(1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1),
}

const gloom: PoseAnimation = {
  kind: 'pose',
  left: 16,
  top: 8,
  width: 48,
  height: 64,
  frame: effectFrames.gloom,
  x: Int8Array.of(-2, -2, -1, -1, 0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0, -1, -2),
  y: Int8Array.of(-9, -10, -9, -7, -4, 1, 6, 8, 8, 8, 8, 8, 7, 5, 1, -3, -6, -8),
}

const sleepy: BubbleAnimation = {
  kind: 'bubble',
  left: 16,
  top: 8,
  width: 48,
  height: 64,
  duration: 1450,
}

const sweat: DropAnimation = {
  kind: 'drop',
  left: 8,
  top: 10,
  width: 72,
  height: 100,
  frames: [effectFrames.smallSweat, effectFrames.sweat, effectFrames.sweatSplash],
  lanes: [0.54, 0.75],
  duration: 1400,
  smallScale: 0.26,
  holdScale: 0.3,
  minScale: 0.24,
}

const tear: DropAnimation = {
  kind: 'drop',
  left: 60,
  top: 96,
  width: 200,
  height: 60,
  frames: [effectFrames.smallTear, effectFrames.tear, effectFrames.tearSplash],
  lanes: [0.15, 0.85],
  duration: 1080,
  smallScale: 0.33,
  holdScale: 0.39,
  minScale: 0.3,
}

const animations = { heart, angry, sweat, tear, sleepy, gloom }
type Animation = PoseAnimation | DropAnimation | BubbleAnimation

class EmoticonPortBehavior extends Behavior {
  #elapsed = 0
  #animation: Animation
  #sprites: EffectSprite[] = []
  #duration: number
  #growUntil = 0

  constructor(options: EmoticonOptions, animation: Animation) {
    super()
    this.#animation = animation
    this.#duration = animation.kind === 'pose' ? animation.x.length * POSE_DURATION : animation.duration
    const requestedCount = options.count ?? 2
    const count =
      animation.kind === 'pose'
        ? 1
        : animation.kind === 'drop'
          ? Math.max(1, Math.min(2, requestedCount))
          : requestedCount
    for (let index = 0; index < count; index++) this.#sprites.push(new EffectSprite())
    if (animation.kind === 'drop') {
      const small = options.smallScale ?? animation.smallScale
      const hold = options.holdScale ?? animation.holdScale
      const midpoint = (Math.max(animation.minScale, small * 0.9) + hold) / 2
      const growth = (midpoint - small) / Math.max(0.01, hold - small)
      this.#growUntil = Math.max(0, Math.min(1, growth)) * 0.55
    }
  }

  onDisplaying(port: PiuPort) {
    this.#update(port)
    port.start()
  }

  onUndisplaying(port: PiuPort) {
    port.stop()
  }

  onTimeChanged(port: PiuPort) {
    this.#elapsed = (this.#elapsed + port.interval) % this.#duration
    this.#update(port)
  }

  onDraw(port: PiuPort) {
    const sprites = this.#sprites
    for (let index = 0; index < sprites.length; index++) sprites[index].draw(port)
  }

  #update(port: PiuPort) {
    const animation = this.#animation
    const sprites = this.#sprites
    if (sprites.length === 0) return
    if (animation.kind === 'pose') {
      const pose = Math.floor(this.#elapsed / POSE_DURATION)
      const frame = animation.useRebound?.[pose] && animation.rebound ? animation.rebound : animation.frame
      sprites[0].place(port, frame, port.width / 2 + animation.x[pose], port.height / 2 + animation.y[pose])
      return
    }

    const progress = this.#elapsed / this.#duration
    if (animation.kind === 'bubble') {
      for (let index = 0; index < sprites.length; index++) {
        const phase = (progress + index / sprites.length) % 1
        this.#updateBubble(port, sprites[index], phase, index % 2 === 0 ? -1 : 1)
      }
      return
    }

    if (sprites.length > 1) {
      this.#updateDrop(port, sprites[0], animation, animation.lanes[0], progress, -1)
      this.#updateDrop(port, sprites[1], animation, animation.lanes[1], (progress + 0.5) % 1, 1)
    } else {
      this.#updateDrop(port, sprites[0], animation, 0.5, progress, 1)
    }
  }

  #updateBubble(port: PiuPort, sprite: EffectSprite, progress: number, direction: number) {
    if (progress >= 0.91) {
      sprite.hide(port)
      return
    }

    const travel = Math.min(1, progress / 0.8)
    const frame = progress < 0.8 ? effectFrames.sleepyBubble : effectFrames.sleepyPop
    const x = port.width / 2 + direction * (3 + 24 * travel * (1 - travel))
    const y = port.height - 9 - Math.max(0, port.height - 17) * travel
    sprite.place(port, frame, x, y)
  }

  #updateDrop(
    port: PiuPort,
    sprite: EffectSprite,
    animation: DropAnimation,
    lane: number,
    progress: number,
    direction: number,
  ) {
    if (progress >= 0.9) {
      sprite.hide(port)
      return
    }

    const travel = Math.min(1, progress / 0.76)
    const frame = animation.frames[progress >= 0.76 ? 2 : progress >= this.#growUntil ? 1 : 0]
    const x = port.width * lane + direction * (2 + 5 * travel * travel)
    const y = 8 + Math.max(0, port.height - 17) * travel * travel
    sprite.place(port, frame, x, y)
  }
}

const EmoticonPort = Port.template(({ options, animation }: { options: EmoticonOptions; animation: Animation }) => ({
  left: options.left ?? animation.left,
  right: options.right,
  top: options.top ?? animation.top,
  bottom: options.bottom,
  width: options.width ?? animation.width,
  height: options.height ?? animation.height,
  interval: options.interval ?? ANIMATION_INTERVAL,
  Behavior: class extends EmoticonPortBehavior {
    constructor() {
      super(options, animation)
    }
  },
}))

class EmoticonBehavior extends Behavior {
  #enabled = true
  #visible = true
  #running = false
  #displayed = false

  setMotionsEnabled(container: PiuContainer, enabled: boolean) {
    if (this.#enabled === enabled) return
    this.#enabled = enabled
    const child = container.first
    if (enabled) {
      container.visible = this.#visible
      if (this.#running && container.application) child?.start()
    } else {
      this.#visible = container.visible
      // 初回表示前の子もonDisplayingで開始するため、再開の意図を保持する
      this.#running = !!child?.running || !this.#displayed
      child?.stop()
      container.visible = false
    }
  }

  onDisplaying(container: PiuContainer) {
    this.#displayed = true
    if (!this.#enabled) {
      // Piuは子のonDisplayingを先に呼ぶため、親の表示時にも停止する
      container.first?.stop()
      container.visible = false
    }
  }

  onUndisplaying() {
    this.#displayed = false
  }
}

export const Emoticon = Container.template((params: EmoticonParams) => {
  const options = params ?? { key: 'heart' }
  const animation = Object.hasOwn(animations, options.key) ? animations[options.key] : heart
  return {
    name: options.name ?? `Emoticon:${options.key}`,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    active: false,
    Behavior: EmoticonBehavior,
    contents: [new EmoticonPort({ options, animation })],
  }
})
