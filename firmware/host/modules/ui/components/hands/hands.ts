import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, DEFAULT_FACE_SECONDARY_COLOR, toPiuColorString } from 'face-state'
import {
  HAND_SPRITE_CELL_SIZE,
  type HandDirection,
  type Handedness,
  type HandSpriteState,
  handDirectionFromRotationUnits,
  handSpriteColumnFromRotationUnits,
  handSpriteRow,
  nearestHandRotationUnits,
} from 'hand-sprites'
import { type Port as PiuPort, type Texture as PiuTexture, Port, Texture } from 'piu/MC'
import Timeline from 'piu/Timeline'

const DEFAULT_ANIMATION_INTERVAL_MS = 100
const HAND_SCREEN_WIDTH = 320
const HALF_CELL = HAND_SPRITE_CELL_SIZE / 2
const HAND_EDGE_CENTER_X = 48

export const HAND_ANIMATION_NAMES = ['none', 'rock-paper-scissors', 'clap', 'thinking'] as const

export type HandAnimationName = (typeof HAND_ANIMATION_NAMES)[number]

export type HandScreenPose = Readonly<{
  position: Readonly<{ x: number; y: number }>
  rotation: Readonly<{ r: number }>
}>

export type HandState = Readonly<{
  shape: HandSpriteState
  pose: HandScreenPose
}>

export type HandPairState = Readonly<{
  left?: HandState
  right?: HandState
}>

export type HandAnimationFrame = Readonly<{
  hands: HandPairState
  transitionMs: number
  holdMs: number
  easing?: (fraction: number) => number
}>

export type HandAnimationSpec = Readonly<{
  frames: readonly HandAnimationFrame[]
  intervalMs?: number
  loop: boolean
}>

type CompiledHandFrame = {
  visible: boolean
  shape: HandSpriteState
  x: number
  y: number
  rotationUnits: number
}

type CompiledFrame = {
  left: CompiledHandFrame
  right: CompiledHandFrame
  transitionMs: number
  holdMs: number
  easing?: (fraction: number) => number
}

type MotionModel = {
  leftX: number
  leftY: number
  leftRotation: number
  rightX: number
  rightY: number
  rightRotation: number
}

type RenderHand = {
  handedness: Handedness
  visible: boolean
  shape: HandSpriteState
  direction: HandDirection
  directionIndex: number
  x: number
  y: number
  sourceX: number
  sourceY: number
}

type AnimationPhase = {
  timeline: Timeline
  cueMs: number
  target: CompiledFrame
  cueApplied: boolean
}

let outerTexture: PiuTexture | undefined
let innerTexture: PiuTexture | undefined

function getOuterTexture(): PiuTexture {
  outerTexture ??= new Texture('hands-outer-mask.png')
  return outerTexture
}

function getInnerTexture(): PiuTexture {
  innerTexture ??= new Texture('hands-inner-mask.png')
  return innerTexture
}

function hand(shape: HandSpriteState, x: number, y: number, r: number): HandState {
  return { shape, pose: { position: { x, y }, rotation: { r } } }
}

function pair(shape: HandSpriteState, y: number): HandPairState {
  return {
    left: hand(shape, HAND_EDGE_CENTER_X, y, Math.PI / 4),
    right: hand(shape, HAND_SCREEN_WIDTH - HAND_EDGE_CENTER_X, y, -Math.PI / 4),
  }
}

function clap(closed: boolean): HandPairState {
  const centerOffset = closed ? 19 : 44
  return {
    left: hand('side-open', HAND_SCREEN_WIDTH / 2 - centerOffset, 144, closed ? 0 : -Math.PI / 4),
    right: hand('side-open', HAND_SCREEN_WIDTH / 2 + centerOffset, 144, closed ? 0 : Math.PI / 4),
  }
}

function thinking(lowered: boolean): HandPairState {
  const inset = lowered ? 72 : 66
  return {
    right: hand('point', HAND_SCREEN_WIDTH - inset - HAND_EDGE_CENTER_X, lowered ? 172 : 168, -Math.PI / 4),
  }
}

function frame(hands: HandPairState, transitionMs: number, holdMs: number): HandAnimationFrame {
  return { hands, transitionMs, holdMs }
}

const HAND_ANIMATION_SPECS: Readonly<Record<Exclude<HandAnimationName, 'none'>, HandAnimationSpec>> = {
  'rock-paper-scissors': {
    frames: [
      frame(pair('fist', 150), 380, 520),
      frame(pair('peace', 142), 420, 620),
      frame(pair('open', 141), 420, 620),
    ],
    loop: true,
  },
  clap: {
    frames: [frame(clap(false), 150, 90), frame(clap(true), 120, 50)],
    intervalMs: 50,
    loop: true,
  },
  thinking: {
    frames: [frame(thinking(false), 620, 720), frame(thinking(true), 620, 820)],
    loop: true,
  },
}

export function isHandAnimationName(value: unknown): value is HandAnimationName {
  return value === 'none' || value === 'rock-paper-scissors' || value === 'clap' || value === 'thinking'
}

function defaultCompiledHand(handedness: Handedness): CompiledHandFrame {
  return {
    visible: false,
    shape: 'fist',
    x: handedness === 'left' ? HAND_EDGE_CENTER_X : HAND_SCREEN_WIDTH - HAND_EDGE_CENTER_X,
    y: 144,
    rotationUnits: 0,
  }
}

function compileHandFrame(state: HandState | undefined, previous: CompiledHandFrame): CompiledHandFrame {
  if (!state) return { ...previous, visible: false }
  return {
    visible: true,
    shape: state.shape,
    x: Math.round(state.pose.position.x),
    y: Math.round(state.pose.position.y),
    rotationUnits: nearestHandRotationUnits(previous.rotationUnits, state.pose.rotation.r),
  }
}

function compileFrame(source: HandAnimationFrame, previous: CompiledFrame): CompiledFrame {
  return {
    left: compileHandFrame(source.hands.left, previous.left),
    right: compileHandFrame(source.hands.right, previous.right),
    transitionMs: Math.max(1, Math.round(source.transitionMs)),
    holdMs: Math.max(0, Math.round(source.holdMs)),
    easing: source.easing,
  }
}

function initialCompiledFrame(): CompiledFrame {
  return {
    left: defaultCompiledHand('left'),
    right: defaultCompiledHand('right'),
    transitionMs: 1,
    holdMs: 0,
  }
}

function motionValues(source: CompiledHandFrame, target: CompiledHandFrame): readonly [number, number][] {
  if (!source.visible && target.visible) {
    return [
      [target.x, target.x],
      [target.y, target.y],
      [target.rotationUnits, target.rotationUnits],
    ]
  }
  if (source.visible && !target.visible) {
    return [
      [source.x, source.x],
      [source.y, source.y],
      [source.rotationUnits, source.rotationUnits],
    ]
  }
  return [
    [source.x, target.x],
    [source.y, target.y],
    [source.rotationUnits, target.rotationUnits],
  ]
}

function intersects(x: number, y: number, width: number, height: number, hand: RenderHand): boolean {
  const handX = hand.x - HALF_CELL
  const handY = hand.y - HALF_CELL
  return (
    x < handX + HAND_SPRITE_CELL_SIZE && x + width > handX && y < handY + HAND_SPRITE_CELL_SIZE && y + height > handY
  )
}

class HandsBehavior extends Behavior {
  #animation: HandAnimationName = 'none'
  #compiledFrames: readonly CompiledFrame[] = []
  #displaying = false
  #inner = toPiuColorString(DEFAULT_FACE_SECONDARY_COLOR)
  #intervalMs = DEFAULT_ANIMATION_INTERVAL_MS
  #loop = false
  #motion: MotionModel = {
    leftX: HAND_EDGE_CENTER_X,
    leftY: 144,
    leftRotation: 0,
    rightX: HAND_SCREEN_WIDTH - HAND_EDGE_CENTER_X,
    rightY: 144,
    rightRotation: 0,
  }
  #outer = toPiuColorString(DEFAULT_FACE_PRIMARY_COLOR)
  #phaseIndex = 0
  #phases: AnimationPhase[] = []
  #primaryColor = DEFAULT_FACE_PRIMARY_COLOR
  #secondaryColor = DEFAULT_FACE_SECONDARY_COLOR

  readonly leftState: RenderHand = {
    handedness: 'left',
    visible: false,
    shape: 'fist',
    direction: 'up',
    directionIndex: 0,
    x: HAND_EDGE_CENTER_X,
    y: 144,
    sourceX: 0,
    sourceY: handSpriteRow('left', 'fist') * HAND_SPRITE_CELL_SIZE,
  }

  readonly rightState: RenderHand = {
    handedness: 'right',
    visible: false,
    shape: 'fist',
    direction: 'up',
    directionIndex: 0,
    x: HAND_SCREEN_WIDTH - HAND_EDGE_CENTER_X,
    y: 144,
    sourceX: 0,
    sourceY: handSpriteRow('right', 'fist') * HAND_SPRITE_CELL_SIZE,
  }

  get primaryColor(): number {
    return this.#primaryColor
  }

  get secondaryColor(): number {
    return this.#secondaryColor
  }

  onCreate(port: PiuPort): void {
    port.interval = DEFAULT_ANIMATION_INTERVAL_MS
  }

  onDisplaying(port: PiuPort): void {
    this.#displaying = true
    this.#restart(port)
  }

  onUndisplaying(port: PiuPort): void {
    this.#displaying = false
    port.stop()
  }

  onHandAnimationChanged(port: PiuPort, animation: unknown): boolean {
    if (!isHandAnimationName(animation)) return true
    this.#animation = animation
    port.stop()
    this.#phaseIndex = 0
    this.#phases = []
    this.#compiledFrames = []
    this.#loop = false

    if (animation === 'none') {
      this.#hideHands(port)
      return true
    }

    this.#prepareAnimation(HAND_ANIMATION_SPECS[animation])
    if (this.#displaying) this.#restart(port)
    else this.#applyFrameInstantly(port, this.#compiledFrames[0])
    return true
  }

  onFaceSkin(port: PiuPort, palette: FaceSkinPalette): void {
    if (this.#primaryColor === palette.primaryColor && this.#secondaryColor === palette.secondaryColor) return
    this.#invalidateHand(port, this.leftState)
    this.#invalidateHand(port, this.rightState)
    this.#primaryColor = palette.primaryColor
    this.#secondaryColor = palette.secondaryColor
    this.#outer = toPiuColorString(palette.primaryColor)
    this.#inner = toPiuColorString(palette.secondaryColor)
  }

  onTimeChanged(port: PiuPort): void {
    // Timeline mutates the preallocated numeric motion model. Keep this paint
    // hot path free of allocation and layout mutation; it only invalidates the
    // old and new fixed-cell regions through #applyMotion.
    const phase = this.#phases[this.#phaseIndex]
    if (!phase) return
    phase.timeline.seekTo(port.time)
    if (!phase.cueApplied && port.time >= phase.cueMs) {
      phase.cueApplied = true
      this.#applyDiscreteFrame(port, phase.target)
    }
    this.#applyMotion(port)
  }

  onFinished(port: PiuPort): void {
    const phase = this.#phases[this.#phaseIndex]
    if (!phase) return
    phase.timeline.seekTo(phase.timeline.duration)
    if (!phase.cueApplied) {
      phase.cueApplied = true
      this.#applyDiscreteFrame(port, phase.target)
    }
    this.#applyMotion(port)

    const nextIndex = this.#phaseIndex + 1
    if (nextIndex < this.#phases.length) {
      this.#startPhase(port, nextIndex)
    } else if (this.#loop && this.#phases.length > 0) {
      this.#startPhase(port, 0)
    }
  }

  onDraw(port: PiuPort, x: number, y: number, width: number, height: number): void {
    this.#drawHand(port, this.leftState, x, y, width, height)
    this.#drawHand(port, this.rightState, x, y, width, height)
  }

  #prepareAnimation(spec: HandAnimationSpec): void {
    let previous = initialCompiledFrame()
    const compiled: CompiledFrame[] = []
    for (const source of spec.frames) {
      const next = compileFrame(source, previous)
      compiled.push(next)
      previous = next
    }
    this.#compiledFrames = compiled
    this.#intervalMs = spec.intervalMs ?? DEFAULT_ANIMATION_INTERVAL_MS
    this.#loop = spec.loop
    if (compiled.length < 2 && !spec.loop) return

    const phases: AnimationPhase[] = []
    for (let index = 1; index < compiled.length; index++) {
      phases.push(this.#createPhase(compiled[index - 1], compiled[index]))
    }
    if (spec.loop && compiled.length > 1) {
      const loopTarget = compileFrame(spec.frames[0], compiled[compiled.length - 1])
      phases.push(this.#createPhase(compiled[compiled.length - 1], loopTarget))
    }
    this.#phases = phases
  }

  #createPhase(source: CompiledFrame, target: CompiledFrame): AnimationPhase {
    const left = motionValues(source.left, target.left)
    const right = motionValues(source.right, target.right)
    const timeline = new Timeline()
    timeline.on(
      this.#motion,
      {
        leftX: left[0],
        leftY: left[1],
        leftRotation: left[2],
        rightX: right[0],
        rightY: right[1],
        rightRotation: right[2],
      },
      target.transitionMs,
      target.easing ?? Math.quadEaseInOut,
      source.holdMs,
    )
    return { timeline, cueMs: source.holdMs, target, cueApplied: false }
  }

  #restart(port: PiuPort): void {
    const first = this.#compiledFrames[0]
    if (!first || this.#animation === 'none') {
      this.#hideHands(port)
      return
    }
    port.stop()
    this.#applyFrameInstantly(port, first)
    if (this.#phases.length > 0) this.#startPhase(port, 0)
  }

  #startPhase(port: PiuPort, index: number): void {
    const phase = this.#phases[index]
    if (!phase) return
    port.stop()
    this.#phaseIndex = index
    phase.cueApplied = false
    phase.timeline.seekTo(0)
    if (phase.cueMs === 0) {
      phase.cueApplied = true
      this.#applyDiscreteFrame(port, phase.target)
    }
    this.#applyMotion(port)
    port.interval = this.#intervalMs
    port.duration = phase.timeline.duration
    port.time = 0
    port.start()
  }

  #applyFrameInstantly(port: PiuPort, frame: CompiledFrame): void {
    this.#invalidateHand(port, this.leftState)
    this.#invalidateHand(port, this.rightState)
    this.#motion.leftX = frame.left.x
    this.#motion.leftY = frame.left.y
    this.#motion.leftRotation = frame.left.rotationUnits
    this.#motion.rightX = frame.right.x
    this.#motion.rightY = frame.right.y
    this.#motion.rightRotation = frame.right.rotationUnits
    this.#assignRenderHand(this.leftState, frame.left)
    this.#assignRenderHand(this.rightState, frame.right)
    this.#invalidateHand(port, this.leftState)
    this.#invalidateHand(port, this.rightState)
  }

  #assignRenderHand(render: RenderHand, frame: CompiledHandFrame): void {
    const directionIndex = handSpriteColumnFromRotationUnits(frame.rotationUnits)
    render.visible = frame.visible
    render.shape = frame.shape
    render.directionIndex = directionIndex
    render.direction = handDirectionFromRotationUnits(frame.rotationUnits)
    render.x = frame.x
    render.y = frame.y
    render.sourceX = directionIndex * HAND_SPRITE_CELL_SIZE
    render.sourceY = handSpriteRow(render.handedness, frame.shape) * HAND_SPRITE_CELL_SIZE
  }

  #applyDiscreteFrame(port: PiuPort, frame: CompiledFrame): void {
    this.#applyDiscreteHand(port, this.leftState, frame.left)
    this.#applyDiscreteHand(port, this.rightState, frame.right)
  }

  #applyDiscreteHand(port: PiuPort, render: RenderHand, frame: CompiledHandFrame): void {
    if (render.visible === frame.visible && render.shape === frame.shape) return
    const wasVisible = render.visible
    if (wasVisible) this.#invalidateHand(port, render)
    render.visible = frame.visible
    render.shape = frame.shape
    render.sourceY = handSpriteRow(render.handedness, frame.shape) * HAND_SPRITE_CELL_SIZE
    if (!wasVisible && render.visible) this.#invalidateHand(port, render)
  }

  #applyMotion(port: PiuPort): void {
    this.#applyHandMotion(port, this.leftState, this.#motion.leftX, this.#motion.leftY, this.#motion.leftRotation)
    this.#applyHandMotion(port, this.rightState, this.#motion.rightX, this.#motion.rightY, this.#motion.rightRotation)
  }

  #applyHandMotion(port: PiuPort, render: RenderHand, x: number, y: number, rotationUnits: number): void {
    const nextX = Math.round(x)
    const nextY = Math.round(y)
    const nextDirectionIndex = handSpriteColumnFromRotationUnits(rotationUnits)
    const moved = render.x !== nextX || render.y !== nextY
    const changedDirection = render.directionIndex !== nextDirectionIndex
    if (!moved && !changedDirection) return
    if (render.visible) this.#invalidateHand(port, render)
    render.x = nextX
    render.y = nextY
    if (changedDirection) {
      render.directionIndex = nextDirectionIndex
      render.direction = handDirectionFromRotationUnits(rotationUnits)
      render.sourceX = nextDirectionIndex * HAND_SPRITE_CELL_SIZE
    }
    if (render.visible && moved) this.#invalidateHand(port, render)
  }

  #hideHands(port: PiuPort): void {
    this.#invalidateHand(port, this.leftState)
    this.#invalidateHand(port, this.rightState)
    this.leftState.visible = false
    this.rightState.visible = false
  }

  #invalidateHand(port: PiuPort, handState: RenderHand): void {
    if (!handState.visible) return
    port.invalidate(handState.x - HALF_CELL, handState.y - HALF_CELL, HAND_SPRITE_CELL_SIZE, HAND_SPRITE_CELL_SIZE)
  }

  #drawHand(port: PiuPort, handState: RenderHand, x: number, y: number, width: number, height: number): void {
    if (!handState.visible || !intersects(x, y, width, height, handState)) return
    const targetX = handState.x - HALF_CELL
    const targetY = handState.y - HALF_CELL
    port.drawTexture(
      getOuterTexture(),
      this.#outer,
      targetX,
      targetY,
      handState.sourceX,
      handState.sourceY,
      HAND_SPRITE_CELL_SIZE,
      HAND_SPRITE_CELL_SIZE,
    )
    port.drawTexture(
      getInnerTexture(),
      this.#inner,
      targetX,
      targetY,
      handState.sourceX,
      handState.sourceY,
      HAND_SPRITE_CELL_SIZE,
      HAND_SPRITE_CELL_SIZE,
    )
  }
}

/**
 * A fixed full-screen Port that draws both animated, theme-colored hands.
 * Both hands share this one content node so animation never changes Piu
 * coordinates or calls moveBy; only sprite selection and invalidation change.
 */
export const Hands = Port.template(() => ({
  name: 'hands',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  active: false,
  Behavior: HandsBehavior,
}))
