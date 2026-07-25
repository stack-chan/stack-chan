export type InteractionInput =
  | {
      readonly type: 'petted'
      readonly strength: number
    }
  | {
      readonly type: 'body-motion'
      readonly motion: 'shaken' | 'fallen' | 'upside-down'
      readonly strength: number
    }
  | {
      readonly type: 'conversation-phase'
      readonly phase: 'idle' | 'user-speaking' | 'thinking' | 'assistant-speaking' | 'failed'
    }

export type InteractionSignal = {
  readonly type: 'speech-envelope'
  readonly value: number
}

/**
 * One Action may occupy each layer. Frames are composed in this order, so a
 * later layer has the final say for channels it controls.
 */
export type ActionLayer = 'ambient' | 'conversation' | 'interaction'

/**
 * Policy applied when the requested Action's layer is already occupied.
 *
 * - `replace`: replace a different Action, but keep the same Action running.
 * - `restart`: replace or restart the current Action.
 * - `ignore`: leave the current Action untouched.
 */
export type ActionPolicy = 'replace' | 'restart' | 'ignore'

export type BehaviorMode = 'idle' | 'listen' | 'think' | 'speak' | 'react' | 'error'

export type BehaviorExpression =
  | 'neutral'
  | 'pleased'
  | 'distressed'
  | 'angry'
  | 'overheated'
  | 'sleepy'
  | 'doubtful'
  | 'cold'

export type BehaviorEffectKey = 'heart' | 'angry' | 'sweat' | 'tear' | 'sleepy'

export type ActionFinishReason = 'completed' | 'stopped' | 'replaced' | 'restarted' | 'manual-override' | 'output-error'

/**
 * Borrowed by `onEvent` until that callback returns. Copy the fields when they
 * must be retained.
 */
export type ActionFinishedEvent<ActionId extends string = string> = {
  readonly type: 'action-finished'
  readonly actionId: ActionId
  readonly layer: ActionLayer
  readonly reason: ActionFinishReason
}

export type BehaviorEvent<ActionId extends string = string> = InteractionInput | ActionFinishedEvent<ActionId>

export type AffectState = {
  arousal: number
  valence: number
  focus: number
  fatigue: number
}

export type Easing = 'linear' | 'in-cubic' | 'out-cubic' | 'in-out-cubic' | 'out-back'

/**
 * `easing` applies from this keyframe to the following keyframe.
 */
export type TrackKeyframe = {
  readonly at: number
  readonly value: number
  readonly easing?: Easing
}

export type ScalarTrack = readonly TrackKeyframe[]

export type EyeActionTracks = {
  readonly open?: ScalarTrack
  readonly lowerLid?: ScalarTrack
  readonly browTilt?: ScalarTrack
  readonly gazeX?: ScalarTrack
  readonly gazeY?: ScalarTrack
}

export type FaceActionTracks = {
  readonly eyes?: {
    readonly left?: EyeActionTracks
    readonly right?: EyeActionTracks
  }
  readonly mouth?: {
    readonly open?: ScalarTrack
    readonly smile?: ScalarTrack
  }
  readonly breath?: {
    readonly amplitude?: ScalarTrack
    readonly rate?: ScalarTrack
  }
}

/**
 * A declarative, clock-driven performance. Face values are absolute channel
 * targets, motion values are relative radians, and lighting values are
 * normalized RGB. `weight` blends the whole Action over its lifetime.
 */
export type ActionDefinition = {
  readonly layer: ActionLayer
  readonly mode?: BehaviorMode
  readonly expression?: BehaviorExpression
  readonly durationMs: number
  readonly loop?: boolean
  readonly weight?: ScalarTrack
  readonly tracks: {
    readonly face?: FaceActionTracks
    readonly effect?: {
      readonly key: BehaviorEffectKey
      readonly opacity: ScalarTrack
    }
    /**
     * Radian offsets relative to the body rotation captured when Action motion
     * first obtains the runtime output lease.
     */
    readonly motion?: {
      readonly yaw?: ScalarTrack
      readonly pitch?: ScalarTrack
      readonly roll?: ScalarTrack
    }
    /**
     * Normalized RGB channels in the range 0..1.
     */
    readonly lighting?: {
      readonly r?: ScalarTrack
      readonly g?: ScalarTrack
      readonly b?: ScalarTrack
    }
  }
}

export type PlayActionOptions = {
  readonly policy: ActionPolicy
  readonly gain?: number
}

export type BehaviorAPI<ActionId extends string = string> = {
  impulseAffect(delta: Readonly<Partial<AffectState>>, gain?: number): void
  setMode(mode: BehaviorMode): void
  play(actionId: ActionId, options: PlayActionOptions): void
  stop(layer: ActionLayer): void
  random(): number
}

/**
 * Reserved output shapes for a later audio command adapter.
 * The Interaction MVP does not execute or queue these commands.
 */
export type BehaviorCommand =
  | {
      readonly type: 'speak'
      readonly text: string
    }
  | {
      readonly type: 'earcon'
      readonly id: string
    }

export type BehaviorFrameEye = {
  open: number
  lowerLid: number
  browTilt: number
  gazeX: number
  gazeY: number
}

/**
 * A borrowed output snapshot. The engine alternates two preallocated frames;
 * consumers must apply or copy it synchronously.
 */
export type BehaviorFrame = {
  seq: number
  at: number
  mode: BehaviorMode
  expression: BehaviorExpression
  affect: AffectState
  face: {
    eyes: {
      left: BehaviorFrameEye
      right: BehaviorFrameEye
    }
    mouth: {
      open: number
      smile: number
    }
    breath: {
      amplitude: number
      rate: number
    }
  }
  effect: {
    key: BehaviorEffectKey | null
    opacity: number
  }
  motion: {
    active: boolean
    yaw: number
    pitch: number
    roll: number
  }
  lighting: {
    active: boolean
    r: number
    g: number
    b: number
  }
  speechEnvelope: number
}

export type InteractionOutput = 'face' | 'effect' | 'motion' | 'lighting'

export type InteractionClock = {
  now(): number
}

export type InteractionRandom = {
  next(): number
}
