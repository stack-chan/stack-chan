import type {
  ActionDefinition,
  AffectState,
  BehaviorAPI,
  BehaviorEffectKey,
  BehaviorEvent,
  BehaviorExpression,
  BehaviorFrameEye,
} from 'interaction-types'

export type CharacterReactionProfile = {
  readonly affectDelta: Readonly<AffectState>
  readonly variation: number
}

export type CharacterExpressionPreset = {
  readonly eyes: {
    readonly left: Readonly<BehaviorFrameEye>
    readonly right: Readonly<BehaviorFrameEye>
  }
  readonly mouth: {
    readonly open: number
    readonly smile: number
  }
  readonly breath: {
    readonly amplitude: number
    readonly rate: number
  }
  readonly effect: BehaviorEffectKey | null
}

/**
 * Static character tuning. Event handling and time-varying performance belong
 * to BehaviorDefinition and ActionDefinition rather than this profile.
 */
export type CharacterProfile = {
  readonly affect: {
    readonly baseline: Readonly<AffectState>
    readonly decayPerSecond: Readonly<AffectState>
    readonly thresholds: {
      readonly happyEnter: number
      readonly happyExit: number
      readonly negativeEnter: number
      readonly negativeExit: number
      readonly angryEnter: number
      readonly angryExit: number
      readonly hotEnter: number
      readonly hotExit: number
      readonly hotMinimumValence: number
      readonly sleepyEnter: number
      readonly sleepyExit: number
    }
  }
  readonly reactions: {
    readonly petted: CharacterReactionProfile
    readonly bodyMotion: Readonly<Record<'shaken' | 'fallen' | 'upside-down', CharacterReactionProfile>>
    readonly conversation: Readonly<
      Record<'idle' | 'user-speaking' | 'thinking' | 'assistant-speaking' | 'failed', Readonly<AffectState>>
    >
  }
  readonly expressions: Readonly<Record<BehaviorExpression, CharacterExpressionPreset>>
  readonly smoothingMs: {
    readonly eyeOpen: number
    readonly lowerLid: number
    readonly browTilt: number
    readonly gaze: number
    readonly mouthOpen: number
    readonly mouthSmile: number
    readonly breath: number
    readonly effectOpacity: number
  }
  readonly speech: {
    readonly attackMs: number
    readonly holdMs: number
    readonly releaseMs: number
  }
  readonly motion: {
    readonly maxYaw: number
    readonly maxPitch: number
    readonly maxRoll: number
    readonly updateIntervalMs: number
    readonly returnMs: number
  }
  readonly output: {
    readonly ledName?: string
    readonly lightingUpdateIntervalMs: number
  }
}

/**
 * The author-facing Interaction program: static tuning, named Actions, and one
 * synchronous reducer from semantic events to Behavior API calls.
 */
export type BehaviorDefinition<
  Actions extends Readonly<Record<string, ActionDefinition>> = Readonly<Record<string, ActionDefinition>>,
> = {
  readonly profile: CharacterProfile
  readonly actions: Actions
  readonly onEvent: (
    event: BehaviorEvent<Extract<keyof Actions, string>>,
    behavior: BehaviorAPI<Extract<keyof Actions, string>>,
  ) => void
}

export function defineBehavior<const Actions extends Readonly<Record<string, ActionDefinition>>>(
  definition: BehaviorDefinition<Actions>,
): BehaviorDefinition<Actions> {
  return definition
}

const ZERO_AFFECT = Object.freeze({
  arousal: 0,
  valence: 0,
  focus: 0,
  fatigue: 0,
})

function eye(open: number, lowerLid: number, browTilt: number): Readonly<BehaviorFrameEye> {
  return Object.freeze({
    open,
    lowerLid,
    browTilt,
    gazeX: 0,
    gazeY: 0,
  })
}

function expression(
  open: number,
  lowerLid: number,
  browTilt: number,
  smile: number,
  effect: BehaviorEffectKey | null,
  breathAmplitude = 1,
  breathRate = 1,
): CharacterExpressionPreset {
  const left = eye(open, lowerLid, browTilt)
  const right = eye(open, lowerLid, browTilt)
  return Object.freeze({
    eyes: Object.freeze({ left, right }),
    mouth: Object.freeze({ open: 0, smile }),
    breath: Object.freeze({ amplitude: breathAmplitude, rate: breathRate }),
    effect,
  })
}

const EXPRESSIONS: Readonly<Record<BehaviorExpression, CharacterExpressionPreset>> = Object.freeze({
  neutral: expression(1, 0, 0, 0, null),
  pleased: expression(0.9, 0.65, 0, 0.8, 'heart', 1.05, 1.1),
  distressed: expression(0.85, 0.1, -0.7, -0.65, 'tear', 0.9, 0.85),
  angry: expression(0.8, 0.05, 0.85, -0.5, 'angry', 1.1, 1.35),
  overheated: expression(0.72, 0, 0.2, -0.15, 'sweat', 1.2, 1.55),
  sleepy: expression(0.45, 0, -0.2, -0.1, 'sleepy', 0.65, 0.6),
  doubtful: expression(0.82, 0, -0.35, -0.15, null, 0.9, 0.9),
  cold: expression(0.68, 0, -0.25, -0.25, null, 0.75, 1.2),
})

export const DEFAULT_CHARACTER_PROFILE: CharacterProfile = Object.freeze({
  affect: Object.freeze({
    baseline: ZERO_AFFECT,
    decayPerSecond: Object.freeze({
      arousal: 0.12,
      valence: 0.12,
      focus: 0.1,
      fatigue: 0.06,
    }),
    thresholds: Object.freeze({
      happyEnter: 0.2,
      happyExit: 0.08,
      negativeEnter: -0.2,
      negativeExit: -0.08,
      angryEnter: 0.4,
      angryExit: 0.25,
      hotEnter: 0.65,
      hotExit: 0.25,
      hotMinimumValence: -0.3,
      sleepyEnter: 0.55,
      sleepyExit: 0.35,
    }),
  }),
  reactions: Object.freeze({
    petted: Object.freeze({
      affectDelta: Object.freeze({ arousal: 0.22, valence: 0.65, focus: 0.1, fatigue: -0.08 }),
      variation: 0.08,
    }),
    bodyMotion: Object.freeze({
      shaken: Object.freeze({
        affectDelta: Object.freeze({ arousal: 0.82, valence: -0.14, focus: -0.08, fatigue: 0.05 }),
        variation: 0.08,
      }),
      fallen: Object.freeze({
        affectDelta: Object.freeze({ arousal: 0.58, valence: -0.5, focus: -0.1, fatigue: 0.08 }),
        variation: 0.08,
      }),
      'upside-down': Object.freeze({
        affectDelta: Object.freeze({ arousal: 0.12, valence: -0.58, focus: -0.2, fatigue: 0.18 }),
        variation: 0.06,
      }),
    }),
    conversation: Object.freeze({
      idle: ZERO_AFFECT,
      'user-speaking': Object.freeze({ arousal: 0.08, valence: 0.02, focus: 0.18, fatigue: -0.02 }),
      thinking: Object.freeze({ arousal: 0.16, valence: 0, focus: 0.16, fatigue: 0.02 }),
      'assistant-speaking': Object.freeze({ arousal: 0.12, valence: 0.08, focus: 0.12, fatigue: -0.02 }),
      failed: Object.freeze({ arousal: 0.35, valence: -0.35, focus: -0.25, fatigue: 0.08 }),
    }),
  }),
  expressions: EXPRESSIONS,
  smoothingMs: Object.freeze({
    eyeOpen: 120,
    lowerLid: 180,
    browTilt: 160,
    gaze: 100,
    mouthOpen: 40,
    mouthSmile: 180,
    breath: 400,
    effectOpacity: 180,
  }),
  speech: Object.freeze({
    attackMs: 40,
    holdMs: 160,
    releaseMs: 120,
  }),
  motion: Object.freeze({
    maxYaw: Math.PI / 6,
    maxPitch: Math.PI / 4,
    maxRoll: Math.PI / 8,
    updateIntervalMs: 100,
    returnMs: 220,
  }),
  output: Object.freeze({
    ledName: 'head',
    lightingUpdateIntervalMs: 1000 / 15,
  }),
})
