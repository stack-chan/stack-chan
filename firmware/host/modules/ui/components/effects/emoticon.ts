import { EffectSprite, effectFrames, type SpriteFrame } from 'effects/effect-sprites'
import { Container, type Container as PiuContainer, type Port as PiuPort, Port } from 'piu/MC'

export type EmoticonKey = keyof typeof animations

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
  frames: readonly SpriteFrame[]
  sequence: Uint8Array
  offsetX?: Int8Array
  offsetY?: Int8Array
  opacity?: Uint8Array
  spread?: number
  once?: true
}

type DropAnimation = EffectLayout & {
  kind: 'drop'
  frames: readonly [small: SpriteFrame, falling: SpriteFrame, splash?: SpriteFrame]
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

const POSE_CELL_HEIGHT = 40
const POSE_DURATION = 64
const ANIMATION_INTERVAL = 48

const heart: PoseAnimation = {
  kind: 'pose',
  left: 8,
  top: 6,
  width: 56,
  height: 56,
  frames: [effectFrames.heart, effectFrames.heartSquash],
  offsetX: Int8Array.of(-4, -3, -1, 2, 3, 4, 5, 5, 4, 3, 2, 0, -1, -3, -4, -4, -4, -4),
  offsetY: Int8Array.of(4, 1, -3, -6, -7, -5, -2, 1, 2, -2, -4, -3, 0, 3, 4, 4, 4, 4),
  sequence: Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1),
}

const angry: PoseAnimation = {
  kind: 'pose',
  left: 8,
  top: 6,
  width: 56,
  height: 56,
  frames: [effectFrames.angry, effectFrames.angryRebound],
  offsetX: Int8Array.of(-3, 0, 4, 1, 4, 1, 3, 1, 1, 1, 1, 0, -2),
  offsetY: Int8Array.of(2, -4, -6, -3, -3, -1, -1, 0, 0, 0, 0, 1, 1),
  sequence: Uint8Array.of(1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1),
}

const gloom: PoseAnimation = {
  kind: 'pose',
  left: 16,
  top: 8,
  width: 48,
  height: 64,
  frames: [
    effectFrames.gloomShort,
    effectFrames.gloomLow,
    effectFrames.gloomMedium,
    effectFrames.gloomHigh,
    effectFrames.gloomTall,
  ],
  sequence: Uint8Array.of(0, 0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 3, 2, 1, 0),
}

const thinking: PoseAnimation = {
  kind: 'pose',
  left: 16,
  top: 8,
  width: 56,
  height: 56,
  frames: [effectFrames.thinking],
  sequence: new Uint8Array(18),
  offsetX: Int8Array.of(-2, -2, -1, 0, 1, 2, 3, 3, 3, 3, 3, 2, 1, 0, -1, -2, -2, -2),
  offsetY: Int8Array.of(3, 2, 0, -2, -4, -6, -7, -8, -8, -8, -7, -6, -4, -2, 0, 2, 3, 3),
}

const idea: PoseAnimation = {
  kind: 'pose',
  left: 16,
  top: 8,
  width: 56,
  height: 56,
  frames: [effectFrames.ideaDim, effectFrames.ideaLit],
  sequence: Uint8Array.of(0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  opacity: Uint8Array.of(80, 128, 184, 216, 255, 255, 255, 255, 255, 255, 255, 255, 240, 200, 150, 106),
}

const listening: PoseAnimation = {
  kind: 'pose',
  left: 16,
  top: 83,
  width: 56,
  height: 40,
  frames: [effectFrames.listeningNear, effectFrames.listeningFar],
  sequence: Uint8Array.of(0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  opacity: Uint8Array.of(84, 120, 156, 196, 232, 255, 255, 255, 255, 236, 212, 184, 152, 120, 84, 56),
}

const surprised: PoseAnimation = {
  kind: 'pose',
  left: 18,
  top: 6,
  width: 56,
  height: 64,
  frames: [effectFrames.surprised],
  sequence: new Uint8Array(10),
  offsetY: Int8Array.of(15, 4, -5, -9, -10, -9, -7, -5, -4, -4),
  opacity: Uint8Array.of(168, 255, 255, 255, 255, 240, 200, 126, 56, 0),
  once: true,
}

const blush: PoseAnimation = {
  kind: 'pose',
  left: 72,
  top: 120,
  width: 176,
  height: 28,
  frames: [effectFrames.blush],
  sequence: new Uint8Array(16),
  opacity: Uint8Array.of(48, 72, 104, 144, 184, 220, 248, 255, 255, 255, 248, 218, 184, 144, 104, 72),
  spread: 67,
}

const shiver: PoseAnimation = {
  kind: 'pose',
  left: 22,
  top: 88,
  width: 276,
  height: 46,
  frames: [effectFrames.shiver],
  sequence: new Uint8Array(8),
  offsetX: Int8Array.of(-2, 2, -2, 2, -2, 1, 0, 0),
  offsetY: Int8Array.of(1, -1, 1, -1, 1, 0, 0, 0),
  spread: 114,
}

const sleepy: BubbleAnimation = {
  kind: 'bubble',
  left: 16,
  top: 8,
  width: 60,
  height: 68,
  duration: 1450,
}

const sweat: DropAnimation = {
  kind: 'drop',
  left: 8,
  top: 50,
  width: 64,
  height: 76,
  frames: [effectFrames.smallSweat, effectFrames.sweat],
  lanes: [0.2, 0.5],
  duration: 1280,
  smallScale: 0.26,
  holdScale: 0.3,
  minScale: 0.24,
}

const tear: DropAnimation = {
  kind: 'drop',
  left: 60,
  top: 96,
  width: 200,
  height: 66,
  frames: [effectFrames.smallTear, effectFrames.tear, effectFrames.tearSplash],
  lanes: [0.15, 0.85],
  duration: 1080,
  smallScale: 0.33,
  holdScale: 0.39,
  minScale: 0.3,
}

const animations = { heart, angry, sweat, tear, sleepy, gloom, thinking, idea, listening, surprised, blush, shiver }
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
    this.#duration = animation.kind === 'pose' ? animation.sequence.length * POSE_DURATION : animation.duration
    const requestedCount = options.count ?? 2
    const count =
      animation.kind === 'pose'
        ? animation.spread === undefined
          ? 1
          : 2
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
      if (animation.frames.length === 2) this.#growUntil += 0.16
    }
  }

  onDisplaying(port: PiuPort) {
    if (this.#animation.kind === 'pose' && this.#animation.once) this.#elapsed = 0
    this.#update(port)
    port.start()
  }

  onUndisplaying(port: PiuPort) {
    port.stop()
  }

  onTimeChanged(port: PiuPort) {
    const elapsed = this.#elapsed + port.interval
    if (this.#animation.kind === 'pose' && this.#animation.once && elapsed >= this.#duration) {
      this.#elapsed = this.#duration - 1
      this.#update(port)
      port.stop()
      return
    }
    this.#elapsed = elapsed % this.#duration
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
      const frame = animation.frames[animation.sequence[pose]]
      const x = port.width / 2 + (animation.offsetX?.[pose] ?? 0)
      const top = animation.offsetY ? (port.height - POSE_CELL_HEIGHT) / 2 + animation.offsetY[pose] : 4
      const y = top + frame[3] / 2
      const opacity = animation.opacity?.[pose] ?? 255
      const spread = animation.spread ?? 0
      for (let index = 0; index < sprites.length; index++) {
        if (opacity) sprites[index].place(port, frame, x + (index === 0 ? -spread : spread), y, opacity)
        else sprites[index].hide(port)
      }
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
    const y = port.height - 13 - Math.max(0, port.height - 26) * travel
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

    const frames = animation.frames
    const splash = frames[2]
    const drop = progress >= this.#growUntil ? frames[1] : frames[0]
    if (!splash) {
      const travel = progress / 0.9
      const distance = Math.max(0, port.height - frames[1][3] - 10)
      const top = 6 + distance * travel * travel * travel
      sprite.place(port, drop, port.width * lane, top + drop[3] / 2)
      return
    }

    const travel = Math.min(1, progress / 0.76)
    const frame = progress >= 0.76 ? splash : drop
    const x = port.width * lane + direction * (2 + 5 * travel * travel)
    const y = 14 + Math.max(0, port.height - 30) * travel * travel
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
