import { type CharacterReactionProfile, DEFAULT_CHARACTER_PROFILE, defineBehavior } from 'character-profile'
import type { BehaviorAPI, BehaviorMode, ScalarTrack } from 'interaction-types'

const REACTION_DURATION_MS = 5000

const REACTION_WEIGHT: ScalarTrack = Object.freeze([
  Object.freeze({ at: 0, value: 0, easing: 'out-cubic' as const }),
  Object.freeze({ at: 300, value: 1 }),
  Object.freeze({ at: 4400, value: 1, easing: 'in-out-cubic' as const }),
  Object.freeze({ at: REACTION_DURATION_MS, value: 0 }),
])

const FULL: ScalarTrack = Object.freeze([
  Object.freeze({ at: 0, value: 1 }),
  Object.freeze({ at: REACTION_DURATION_MS, value: 1 }),
])

function target(value: number): ScalarTrack {
  return Object.freeze([Object.freeze({ at: 0, value }), Object.freeze({ at: REACTION_DURATION_MS, value })])
}

function expressionFace(open: number, lowerLid: number, browTilt: number, smile: number) {
  const eye = Object.freeze({
    open: target(open),
    lowerLid: target(lowerLid),
    browTilt: target(browTilt),
  })
  return Object.freeze({
    eyes: Object.freeze({
      left: eye,
      right: eye,
    }),
    mouth: Object.freeze({
      smile: target(smile),
    }),
  })
}

const DELIGHTED_YAW: ScalarTrack = Object.freeze([
  Object.freeze({ at: 0, value: 0, easing: 'in-out-cubic' as const }),
  Object.freeze({ at: 220, value: 0.24, easing: 'in-out-cubic' as const }),
  Object.freeze({ at: 440, value: -0.24, easing: 'in-out-cubic' as const }),
  Object.freeze({ at: 660, value: 0.13, easing: 'in-out-cubic' as const }),
  Object.freeze({ at: 880, value: 0 }),
  Object.freeze({ at: REACTION_DURATION_MS, value: 0 }),
])

const DELIGHTED_PITCH: ScalarTrack = Object.freeze([
  Object.freeze({ at: 0, value: 0, easing: 'out-cubic' as const }),
  Object.freeze({ at: 220, value: -0.35 }),
  Object.freeze({ at: 4400, value: -0.35, easing: 'in-out-cubic' as const }),
  Object.freeze({ at: REACTION_DURATION_MS, value: 0 }),
])

const ACTIONS = Object.freeze({
  delighted: Object.freeze({
    layer: 'interaction' as const,
    mode: 'react' as const,
    expression: 'pleased' as const,
    durationMs: REACTION_DURATION_MS,
    weight: REACTION_WEIGHT,
    tracks: Object.freeze({
      face: expressionFace(0.9, 0.7, 0, 0.85),
      effect: Object.freeze({ key: 'heart' as const, opacity: FULL }),
      motion: Object.freeze({
        yaw: DELIGHTED_YAW,
        pitch: DELIGHTED_PITCH,
      }),
      lighting: Object.freeze({
        r: target(1),
        g: target(0.08),
        b: target(0.28),
      }),
    }),
  }),
  shaken: Object.freeze({
    layer: 'interaction' as const,
    mode: 'react' as const,
    expression: 'overheated' as const,
    durationMs: REACTION_DURATION_MS,
    weight: REACTION_WEIGHT,
    tracks: Object.freeze({
      face: expressionFace(0.72, 0, 0.2, -0.15),
      effect: Object.freeze({ key: 'sweat' as const, opacity: FULL }),
      lighting: Object.freeze({
        r: target(1),
        g: target(0.25),
        b: target(0),
      }),
    }),
  }),
  fallen: Object.freeze({
    layer: 'interaction' as const,
    mode: 'react' as const,
    expression: 'angry' as const,
    durationMs: REACTION_DURATION_MS,
    weight: REACTION_WEIGHT,
    tracks: Object.freeze({
      face: expressionFace(0.8, 0.05, 0.85, -0.5),
      effect: Object.freeze({ key: 'angry' as const, opacity: FULL }),
      lighting: Object.freeze({
        r: target(1),
        g: target(0),
        b: target(0),
      }),
    }),
  }),
  'upside-down': Object.freeze({
    layer: 'interaction' as const,
    mode: 'react' as const,
    expression: 'distressed' as const,
    durationMs: REACTION_DURATION_MS,
    weight: REACTION_WEIGHT,
    tracks: Object.freeze({
      face: expressionFace(0.85, 0.1, -0.7, -0.65),
      effect: Object.freeze({ key: 'tear' as const, opacity: FULL }),
      lighting: Object.freeze({
        r: target(0.1),
        g: target(0.25),
        b: target(1),
      }),
    }),
  }),
})

function applyReaction(
  behavior: BehaviorAPI<keyof typeof ACTIONS>,
  reaction: CharacterReactionProfile,
  strength: number,
) {
  const variation = 1 + (behavior.random() * 2 - 1) * reaction.variation
  behavior.impulseAffect(reaction.affectDelta, Math.max(0, Math.min(1, strength * variation)))
}

function modeForPhase(phase: 'idle' | 'user-speaking' | 'thinking' | 'assistant-speaking' | 'failed'): BehaviorMode {
  switch (phase) {
    case 'user-speaking':
      return 'listen'
    case 'thinking':
      return 'think'
    case 'assistant-speaking':
      return 'speak'
    case 'failed':
      return 'error'
    default:
      return 'idle'
  }
}

export const DEFAULT_BEHAVIOR_DEFINITION = defineBehavior({
  profile: DEFAULT_CHARACTER_PROFILE,
  actions: ACTIONS,
  onEvent(event, behavior) {
    switch (event.type) {
      case 'petted':
        applyReaction(behavior, DEFAULT_CHARACTER_PROFILE.reactions.petted, event.strength)
        behavior.play('delighted', { policy: 'restart', gain: event.strength })
        break
      case 'body-motion':
        applyReaction(behavior, DEFAULT_CHARACTER_PROFILE.reactions.bodyMotion[event.motion], event.strength)
        behavior.play(event.motion, { policy: 'replace', gain: event.strength })
        break
      case 'conversation-phase':
        behavior.setMode(modeForPhase(event.phase))
        behavior.impulseAffect(DEFAULT_CHARACTER_PROFILE.reactions.conversation[event.phase])
        break
      case 'action-finished':
        break
    }
  },
})
