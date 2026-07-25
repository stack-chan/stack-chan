import { BehaviorEngine } from 'behavior-engine'
import type { BehaviorDefinition } from 'character-profile'
import { Emotion } from 'face-state'
import type {
  ActionDefinition,
  BehaviorExpression,
  BehaviorFrame,
  InteractionClock,
  InteractionInput,
  InteractionOutput,
  InteractionRandom,
  InteractionSignal,
} from 'interaction-types'

export type RuntimeInteractionOptions = {
  now: () => number
  random: () => number
  frameIntervalMs: number
  applyFrame: (frame: BehaviorFrame) => void
  applyLegacyEmotion: (emotion: Emotion) => void
}

function expressionForEmotion(emotion: Emotion): BehaviorExpression {
  switch (emotion) {
    case Emotion.HAPPY:
      return 'pleased'
    case Emotion.ANGRY:
      return 'angry'
    case Emotion.SAD:
      return 'distressed'
    case Emotion.HOT:
      return 'overheated'
    case Emotion.SLEEPY:
      return 'sleepy'
    case Emotion.DOUBTFUL:
      return 'doubtful'
    case Emotion.COLD:
      return 'cold'
    default:
      return 'neutral'
  }
}

export function emotionForExpression(expression: BehaviorExpression): Emotion {
  switch (expression) {
    case 'pleased':
      return Emotion.HAPPY
    case 'angry':
      return Emotion.ANGRY
    case 'distressed':
      return Emotion.SAD
    case 'overheated':
      return Emotion.HOT
    case 'sleepy':
      return Emotion.SLEEPY
    case 'doubtful':
      return Emotion.DOUBTFUL
    case 'cold':
      return Emotion.COLD
    default:
      return Emotion.NEUTRAL
  }
}

export class RuntimeInteraction {
  #applyFrame: (frame: BehaviorFrame) => void
  #applyLegacyEmotion: (emotion: Emotion) => void
  #clock: InteractionClock
  #engine: BehaviorEngine
  #frameIntervalMs: number
  #nextFrameAt = -Infinity

  constructor(options: RuntimeInteractionOptions) {
    this.#clock = { now: options.now }
    const random: InteractionRandom = { next: options.random }
    this.#applyFrame = options.applyFrame
    this.#applyLegacyEmotion = options.applyLegacyEmotion
    this.#frameIntervalMs =
      Number.isFinite(options.frameIntervalMs) && options.frameIntervalMs > 0 ? options.frameIntervalMs : 0
    this.#engine = new BehaviorEngine({
      clock: this.#clock,
      random,
    })
  }

  get installed(): boolean {
    return this.#engine.installed
  }

  get profile() {
    return this.#engine.profile
  }

  get frame(): BehaviorFrame | null {
    return this.#engine.frame
  }

  install<const Actions extends Readonly<Record<string, ActionDefinition>>>(
    definition: BehaviorDefinition<Actions>,
  ): void {
    this.#engine.install(definition)
    this.#applyImmediate()
  }

  dispatch(input: InteractionInput): void {
    this.#engine.dispatch(input)
    this.#applyImmediate()
  }

  setSignal(signal: InteractionSignal): void {
    this.#engine.setSignal(signal)
    this.#applyImmediate()
  }

  setBaseEmotion(emotion: Emotion): void {
    this.#applyLegacyEmotion(emotion)
    if (!this.#engine.installed) return
    this.#engine.setBaseExpression(expressionForEmotion(emotion))
    this.#applyImmediate()
  }

  cancelActionsUsing(output: InteractionOutput, reason: 'manual-override' | 'output-error' = 'manual-override'): void {
    if (!this.#engine.installed) return
    this.#engine.cancelActionsUsing(output, reason)
    this.#applyImmediate()
  }

  tick(): void {
    if (!this.#engine.installed || !this.#engine.needsTick) return
    const now = this.#clock.now()
    if (now < this.#nextFrameAt) return
    const previousDeadline = this.#nextFrameAt
    const frame = this.#engine.tick(now)
    this.#apply(frame)
    if (this.#frameIntervalMs <= 0) {
      this.#nextFrameAt = frame.at
      return
    }
    if (!Number.isFinite(previousDeadline) || frame.at - previousDeadline > this.#frameIntervalMs * 4) {
      this.#nextFrameAt = frame.at + this.#frameIntervalMs
      return
    }
    let nextFrameAt = previousDeadline
    do {
      nextFrameAt += this.#frameIntervalMs
    } while (nextFrameAt <= frame.at)
    this.#nextFrameAt = nextFrameAt
  }

  #apply(frame: BehaviorFrame): void {
    this.#applyFrame(frame)
  }

  #applyImmediate(): void {
    const frame = this.#engine.tick(this.#clock.now())
    this.#apply(frame)
    this.#nextFrameAt = frame.at + this.#frameIntervalMs
  }
}
