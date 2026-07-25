import type { BehaviorDefinition, CharacterProfile } from 'character-profile'
import type {
  ActionDefinition,
  ActionFinishedEvent,
  ActionFinishReason,
  ActionLayer,
  AffectState,
  BehaviorAPI,
  BehaviorEffectKey,
  BehaviorExpression,
  BehaviorFrame,
  BehaviorFrameEye,
  BehaviorMode,
  InteractionClock,
  InteractionInput,
  InteractionOutput,
  InteractionRandom,
  InteractionSignal,
  ScalarTrack,
} from 'interaction-types'

const LAYERS = Object.freeze(['ambient', 'conversation', 'interaction'] as const)
const EYE_SIDES = Object.freeze(['left', 'right'] as const)
const MAX_COMPLETION_EVENTS = 16
const SMOOTH_SETTLE_EPSILON = 1 / 4096

type InstalledDefinition = BehaviorDefinition<Readonly<Record<string, ActionDefinition>>>

type ActionSlot = {
  active: boolean
  id: string
  definition: ActionDefinition | null
  startedAt: number
  gain: number
}

type MutableFrame = BehaviorFrame
type MutableActionFinishedEvent = {
  type: 'action-finished'
  actionId: string
  layer: ActionLayer
  reason: ActionFinishReason
}

export type BehaviorEngineOptions = {
  clock: InteractionClock
  random: InteractionRandom
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  if (value < minimum) return minimum
  if (value > maximum) return maximum
  return value
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(value + amount, target)
  return Math.max(value - amount, target)
}

function smoothingFactor(elapsedMs: number, timeConstantMs: number): number {
  if (elapsedMs <= 0) return 0
  if (timeConstantMs <= 0) return 1
  return 1 - Math.exp(-elapsedMs / timeConstantMs)
}

function smooth(value: number, target: number, elapsedMs: number, timeConstantMs: number): number {
  return smoothWithFactor(value, target, smoothingFactor(elapsedMs, timeConstantMs))
}

function smoothWithFactor(value: number, target: number, factor: number): number {
  const delta = target - value
  if (Math.abs(delta) <= SMOOTH_SETTLE_EPSILON) return target
  return value + delta * factor
}

function layerIndex(layer: ActionLayer): number {
  switch (layer) {
    case 'ambient':
      return 0
    case 'conversation':
      return 1
    case 'interaction':
      return 2
  }
}

function ease(value: number, easing: ScalarTrack[number]['easing']): number {
  switch (easing) {
    case 'in-cubic':
      return value * value * value
    case 'out-cubic': {
      const inverse = 1 - value
      return 1 - inverse * inverse * inverse
    }
    case 'in-out-cubic': {
      if (value < 0.5) return 4 * value * value * value
      const inverse = 2 - 2 * value
      return 1 - (inverse * inverse * inverse) / 2
    }
    case 'out-back': {
      const c1 = 1.70158
      const c3 = c1 + 1
      const shifted = value - 1
      return 1 + c3 * shifted * shifted * shifted + c1 * shifted * shifted
    }
    default:
      return value
  }
}

function sampleTrack(track: ScalarTrack | undefined, at: number, fallback: number): number {
  if (!track || track.length === 0) return fallback
  if (track.length === 1) return track[0].value
  if (at <= track[0].at) return track[0].value
  const last = track[track.length - 1]
  if (at >= last.at) return last.value

  for (let index = 0; index < track.length - 1; index += 1) {
    const from = track[index]
    const to = track[index + 1]
    if (at > to.at) continue
    if (from.value === to.value) return from.value
    const duration = to.at - from.at
    if (duration <= 0) return to.value
    const fraction = ease((at - from.at) / duration, from.easing)
    return from.value + (to.value - from.value) * fraction
  }
  return last.value
}

function createEye(preset: Readonly<BehaviorFrameEye>): BehaviorFrameEye {
  return {
    open: preset.open,
    lowerLid: preset.lowerLid,
    browTilt: preset.browTilt,
    gazeX: preset.gazeX,
    gazeY: preset.gazeY,
  }
}

function createFrame(profile: CharacterProfile, at: number): MutableFrame {
  const preset = profile.expressions.neutral
  return {
    seq: 0,
    at,
    mode: 'idle',
    expression: 'neutral',
    affect: { ...profile.affect.baseline },
    face: {
      eyes: {
        left: createEye(preset.eyes.left),
        right: createEye(preset.eyes.right),
      },
      mouth: {
        open: preset.mouth.open,
        smile: preset.mouth.smile,
      },
      breath: {
        amplitude: preset.breath.amplitude,
        rate: preset.breath.rate,
      },
    },
    effect: {
      key: null,
      opacity: 0,
    },
    motion: {
      active: false,
      yaw: 0,
      pitch: 0,
      roll: 0,
    },
    lighting: {
      active: false,
      r: 0,
      g: 0,
      b: 0,
    },
    speechEnvelope: 0,
  }
}

function actionUsesOutput(action: ActionDefinition, output: InteractionOutput): boolean {
  switch (output) {
    case 'face':
      return action.tracks.face !== undefined
    case 'effect':
      return action.tracks.effect !== undefined
    case 'motion':
      return action.tracks.motion !== undefined
    case 'lighting':
      return action.tracks.lighting !== undefined
  }
}

function validateTrack(track: ScalarTrack | undefined, durationMs: number, path: string, loop: boolean): void {
  if (!track) return
  if (track.length === 0) throw new TypeError(`${path} must contain at least one keyframe`)
  let previousAt = -1
  for (let index = 0; index < track.length; index += 1) {
    const keyframe = track[index]
    if (!Number.isFinite(keyframe.at) || !Number.isFinite(keyframe.value)) {
      throw new TypeError(`${path}[${index}] must contain finite at and value`)
    }
    if (keyframe.at < 0 || keyframe.at > durationMs || keyframe.at <= previousAt) {
      throw new RangeError(`${path}[${index}].at must be strictly ascending within the Action duration`)
    }
    previousAt = keyframe.at
  }
  if (loop && track[0].value !== track[track.length - 1].value) {
    throw new RangeError(`${path} must start and end at the same value for a looping Action`)
  }
}

function validateMotionTrack(track: ScalarTrack | undefined, durationMs: number, path: string, loop: boolean): void {
  validateTrack(track, durationMs, path, loop)
  if (!track || loop) return
  if (track[0].value !== 0 || track[track.length - 1].value !== 0) {
    throw new RangeError(`${path} must start and end at zero for a finite relative motion Action`)
  }
}

function validateAction(id: string, action: ActionDefinition): void {
  if (!Number.isFinite(action.durationMs) || action.durationMs <= 0) {
    throw new RangeError(`actions.${id}.durationMs must be greater than zero`)
  }
  const loop = action.loop === true
  validateTrack(action.weight, action.durationMs, `actions.${id}.weight`, loop)
  const face = action.tracks.face
  for (const side of ['left', 'right'] as const) {
    const eye = face?.eyes?.[side]
    validateTrack(eye?.open, action.durationMs, `actions.${id}.tracks.face.eyes.${side}.open`, loop)
    validateTrack(eye?.lowerLid, action.durationMs, `actions.${id}.tracks.face.eyes.${side}.lowerLid`, loop)
    validateTrack(eye?.browTilt, action.durationMs, `actions.${id}.tracks.face.eyes.${side}.browTilt`, loop)
    validateTrack(eye?.gazeX, action.durationMs, `actions.${id}.tracks.face.eyes.${side}.gazeX`, loop)
    validateTrack(eye?.gazeY, action.durationMs, `actions.${id}.tracks.face.eyes.${side}.gazeY`, loop)
  }
  validateTrack(face?.mouth?.open, action.durationMs, `actions.${id}.tracks.face.mouth.open`, loop)
  validateTrack(face?.mouth?.smile, action.durationMs, `actions.${id}.tracks.face.mouth.smile`, loop)
  validateTrack(face?.breath?.amplitude, action.durationMs, `actions.${id}.tracks.face.breath.amplitude`, loop)
  validateTrack(face?.breath?.rate, action.durationMs, `actions.${id}.tracks.face.breath.rate`, loop)
  validateTrack(action.tracks.effect?.opacity, action.durationMs, `actions.${id}.tracks.effect.opacity`, loop)
  validateMotionTrack(action.tracks.motion?.yaw, action.durationMs, `actions.${id}.tracks.motion.yaw`, loop)
  validateMotionTrack(action.tracks.motion?.pitch, action.durationMs, `actions.${id}.tracks.motion.pitch`, loop)
  validateMotionTrack(action.tracks.motion?.roll, action.durationMs, `actions.${id}.tracks.motion.roll`, loop)
  validateTrack(action.tracks.lighting?.r, action.durationMs, `actions.${id}.tracks.lighting.r`, loop)
  validateTrack(action.tracks.lighting?.g, action.durationMs, `actions.${id}.tracks.lighting.g`, loop)
  validateTrack(action.tracks.lighting?.b, action.durationMs, `actions.${id}.tracks.lighting.b`, loop)
}

export class BehaviorEngine {
  #activeActionCount = 0
  #affect: AffectState = { arousal: 0, valence: 0, focus: 0, fatigue: 0 }
  #affectSettled = true
  #api: BehaviorAPI<string>
  #baseExpression: BehaviorExpression = 'neutral'
  #baseMode: BehaviorMode = 'idle'
  #bufferIndex = 0
  #buffers: [MutableFrame, MutableFrame] | null = null
  #clock: InteractionClock
  #completionCount = 0
  #completionEvents: MutableActionFinishedEvent[] = []
  #definition: InstalledDefinition | null = null
  #derivedExpression: BehaviorExpression = 'neutral'
  #effectSettled = true
  #effectKey: BehaviorEffectKey | null = null
  #effectOpacity = 0
  #effectTargetKey: BehaviorEffectKey | null = null
  #effectTargetOpacity = 0
  #effectiveExpression: BehaviorExpression = 'neutral'
  #faceSettled = true
  #lastAt = 0
  #lastFrameAt = 0
  #random: InteractionRandom
  #seq = 0
  #slots: [ActionSlot, ActionSlot, ActionSlot] = [
    { active: false, id: '', definition: null, startedAt: 0, gain: 1 },
    { active: false, id: '', definition: null, startedAt: 0, gain: 1 },
    { active: false, id: '', definition: null, startedAt: 0, gain: 1 },
  ]
  #smoothedFace: MutableFrame['face'] | null = null
  #speechEnvelope = 0
  #speechLastAt = 0
  #speechSettled = true
  #speechTarget = 0

  constructor(options: BehaviorEngineOptions) {
    this.#clock = options.clock
    this.#random = options.random
    const now = this.#safeTime(this.#clock.now(), 0)
    this.#lastAt = now
    this.#lastFrameAt = now
    for (let index = 0; index < MAX_COMPLETION_EVENTS; index += 1) {
      this.#completionEvents.push({
        type: 'action-finished',
        actionId: '',
        layer: 'ambient',
        reason: 'completed',
      })
    }
    this.#api = {
      impulseAffect: (delta, gain) => this.#impulseAffect(delta, gain),
      setMode: (mode) => {
        this.#baseMode = mode
      },
      play: (actionId, playOptions) => this.#play(actionId, playOptions.policy, playOptions.gain),
      stop: (layer) => this.#stopLayer(layer, 'stopped'),
      random: () => clamp(this.#random.next(), 0, 1),
    }
  }

  get installed(): boolean {
    return this.#definition !== null
  }

  get profile(): CharacterProfile | null {
    return this.#definition?.profile ?? null
  }

  get frame(): BehaviorFrame | null {
    return this.#buffers?.[this.#bufferIndex] ?? null
  }

  get needsTick(): boolean {
    return (
      this.#activeActionCount > 0 ||
      !this.#affectSettled ||
      !this.#faceSettled ||
      !this.#effectSettled ||
      !this.#speechSettled
    )
  }

  install<const Actions extends Readonly<Record<string, ActionDefinition>>>(
    definition: BehaviorDefinition<Actions>,
  ): void {
    if (this.#definition) throw new Error('Interaction BehaviorDefinition is already installed')
    const actionIds = Object.keys(definition.actions)
    for (const id of actionIds) validateAction(id, definition.actions[id])

    this.#definition = definition as unknown as InstalledDefinition
    const now = this.#safeTime(this.#clock.now(), this.#lastAt)
    this.#lastAt = now
    this.#lastFrameAt = now
    this.#affect.arousal = definition.profile.affect.baseline.arousal
    this.#affect.valence = definition.profile.affect.baseline.valence
    this.#affect.focus = definition.profile.affect.baseline.focus
    this.#affect.fatigue = definition.profile.affect.baseline.fatigue
    const first = createFrame(definition.profile, now)
    const second = createFrame(definition.profile, now)
    this.#buffers = [first, second]
    this.#smoothedFace = createFrame(definition.profile, now).face
    this.#effectKey = definition.profile.expressions[this.#baseExpression].effect
    this.#effectTargetKey = this.#effectKey
    this.#effectOpacity = this.#effectKey ? 1 : 0
    this.#effectTargetOpacity = this.#effectOpacity
    this.#affectSettled = true
    this.#faceSettled = true
    this.#effectSettled = true
    this.#speechSettled = true
  }

  dispatch(input: InteractionInput, requestedAt = this.#clock.now()): void {
    const definition = this.#requireDefinition()
    const at = this.#advance(requestedAt)
    this.#validateInput(input)
    definition.onEvent(input, this.#api)
    this.#drainCompletionEvents()
    this.#lastAt = at
  }

  setSignal(signal: InteractionSignal, requestedAt = this.#clock.now()): void {
    this.#requireDefinition()
    const at = this.#advance(requestedAt)
    if (signal.type !== 'speech-envelope' || !Number.isFinite(signal.value)) {
      throw new TypeError('speech-envelope signal requires a finite value')
    }
    this.#speechTarget = clamp(signal.value, 0, 1)
    this.#speechLastAt = at
    this.#speechSettled = this.#speechTarget === 0 && this.#speechEnvelope === 0
  }

  setBaseExpression(expression: BehaviorExpression, requestedAt = this.#clock.now()): void {
    const definition = this.#requireDefinition()
    const at = this.#advance(requestedAt)
    if (!definition.profile.expressions[expression]) throw new TypeError(`Unknown BehaviorExpression: ${expression}`)
    this.cancelActionsUsing('face', 'manual-override', at)
    this.cancelActionsUsing('effect', 'manual-override', at)
    const baseline = definition.profile.affect.baseline
    this.#affect.arousal = baseline.arousal
    this.#affect.valence = baseline.valence
    this.#affect.focus = baseline.focus
    this.#affect.fatigue = baseline.fatigue
    this.#affectSettled = true
    this.#derivedExpression = 'neutral'
    this.#baseExpression = expression
    this.#faceSettled = false
    this.#effectSettled = false
    const effect = definition.profile.expressions[expression].effect
    if (effect !== this.#effectTargetKey) {
      this.#effectTargetKey = effect
      if (effect && effect !== this.#effectKey) {
        this.#effectKey = effect
        this.#effectOpacity = 0
      }
    }
    this.#effectTargetOpacity = effect ? 1 : 0
    this.#drainCompletionEvents()
  }

  cancelActionsUsing(
    output: InteractionOutput,
    reason: ActionFinishReason = 'manual-override',
    requestedAt = this.#clock.now(),
  ): void {
    this.#requireDefinition()
    this.#advance(requestedAt)
    for (let index = 0; index < this.#slots.length; index += 1) {
      const slot = this.#slots[index]
      if (slot.active && slot.definition && actionUsesOutput(slot.definition, output)) {
        this.#finishSlot(index, reason)
      }
    }
    this.#drainCompletionEvents()
  }

  tick(requestedAt = this.#clock.now()): BehaviorFrame {
    const definition = this.#requireDefinition()
    if (!this.#buffers || !this.#smoothedFace) throw new Error('Interaction frame buffers are not initialized')
    const at = this.#advance(requestedAt)
    const elapsedMs = at - this.#lastFrameAt
    this.#lastFrameAt = at
    if (this.#activeActionCount > 0) {
      this.#expireActions(at)
      this.#drainCompletionEvents()
    }
    if (!this.#speechSettled) this.#updateSpeech(at, elapsedMs)
    if (!this.#faceSettled || !this.#effectSettled) {
      this.#derivedExpression = this.#deriveExpression()
      const intensity = this.#expressionIntensity(this.#derivedExpression)
      this.#effectiveExpression = intensity > 0 ? this.#derivedExpression : this.#baseExpression
      this.#selectBaseEffect(this.#effectiveExpression, intensity)
      if (!this.#faceSettled) this.#faceSettled = this.#smoothBaseFace(elapsedMs, intensity)
      if (!this.#effectSettled) this.#effectSettled = this.#smoothBaseEffect(elapsedMs)
    }

    this.#bufferIndex = this.#bufferIndex === 0 ? 1 : 0
    const output = this.#buffers[this.#bufferIndex]
    output.seq = ++this.#seq
    output.at = at
    output.mode = this.#baseMode
    output.expression = this.#effectiveExpression
    output.affect.arousal = this.#affect.arousal
    output.affect.valence = this.#affect.valence
    output.affect.focus = this.#affect.focus
    output.affect.fatigue = this.#affect.fatigue
    this.#copySmoothedFace(output)
    output.effect.key = this.#effectKey
    output.effect.opacity = this.#effectOpacity
    output.motion.active = false
    output.motion.yaw = 0
    output.motion.pitch = 0
    output.motion.roll = 0
    output.lighting.active = false
    output.lighting.r = 0
    output.lighting.g = 0
    output.lighting.b = 0
    output.speechEnvelope = this.#speechEnvelope

    if (this.#activeActionCount > 0) {
      for (let index = 0; index < this.#slots.length; index += 1) {
        this.#applySlot(output, this.#slots[index], at)
      }
      this.#clampFace(output)
      if (output.motion.active) {
        const limits = definition.profile.motion
        output.motion.yaw = clamp(output.motion.yaw, -limits.maxYaw, limits.maxYaw)
        output.motion.pitch = clamp(output.motion.pitch, -limits.maxPitch, limits.maxPitch)
        output.motion.roll = clamp(output.motion.roll, -limits.maxRoll, limits.maxRoll)
      }
    }
    if (this.#speechEnvelope > output.face.mouth.open) output.face.mouth.open = this.#speechEnvelope
    return output
  }

  #requireDefinition(): InstalledDefinition {
    if (!this.#definition) throw new Error('Interaction BehaviorDefinition is not installed')
    return this.#definition
  }

  #safeTime(value: number, fallback: number): number {
    return Number.isFinite(value) ? Math.max(fallback, value) : fallback
  }

  #advance(requestedAt: number): number {
    const definition = this.#requireDefinition()
    const at = this.#safeTime(requestedAt, this.#lastAt)
    if (at <= this.#lastAt) return this.#lastAt
    if (this.#affectSettled) {
      this.#lastAt = at
      return at
    }
    const elapsedSeconds = (at - this.#lastAt) / 1000
    const baseline = definition.profile.affect.baseline
    const decay = definition.profile.affect.decayPerSecond
    const previousArousal = this.#affect.arousal
    const previousValence = this.#affect.valence
    const previousFocus = this.#affect.focus
    const previousFatigue = this.#affect.fatigue
    this.#affect.arousal = approach(this.#affect.arousal, baseline.arousal, elapsedSeconds * decay.arousal)
    this.#affect.valence = approach(this.#affect.valence, baseline.valence, elapsedSeconds * decay.valence)
    this.#affect.focus = approach(this.#affect.focus, baseline.focus, elapsedSeconds * decay.focus)
    this.#affect.fatigue = approach(this.#affect.fatigue, baseline.fatigue, elapsedSeconds * decay.fatigue)
    if (
      this.#affect.arousal !== previousArousal ||
      this.#affect.valence !== previousValence ||
      this.#affect.focus !== previousFocus ||
      this.#affect.fatigue !== previousFatigue
    ) {
      this.#faceSettled = false
      this.#effectSettled = false
    }
    this.#affectSettled =
      (this.#affect.arousal === baseline.arousal || decay.arousal <= 0) &&
      (this.#affect.valence === baseline.valence || decay.valence <= 0) &&
      (this.#affect.focus === baseline.focus || decay.focus <= 0) &&
      (this.#affect.fatigue === baseline.fatigue || decay.fatigue <= 0)
    this.#lastAt = at
    return at
  }

  #validateInput(input: InteractionInput): void {
    switch (input.type) {
      case 'petted':
      case 'body-motion':
        if (!Number.isFinite(input.strength)) throw new TypeError(`${input.type}.strength must be finite`)
        break
      case 'conversation-phase':
        break
      default:
        throw new TypeError('Unknown InteractionInput')
    }
  }

  #impulseAffect(delta: Readonly<Partial<AffectState>>, requestedGain = 1): void {
    const gain = clamp(requestedGain, 0, 1)
    const previousArousal = this.#affect.arousal
    const previousValence = this.#affect.valence
    const previousFocus = this.#affect.focus
    const previousFatigue = this.#affect.fatigue
    this.#affect.arousal = clamp(this.#affect.arousal + (delta.arousal ?? 0) * gain, 0, 1)
    this.#affect.valence = clamp(this.#affect.valence + (delta.valence ?? 0) * gain, -1, 1)
    this.#affect.focus = clamp(this.#affect.focus + (delta.focus ?? 0) * gain, 0, 1)
    this.#affect.fatigue = clamp(this.#affect.fatigue + (delta.fatigue ?? 0) * gain, 0, 1)
    if (
      this.#affect.arousal !== previousArousal ||
      this.#affect.valence !== previousValence ||
      this.#affect.focus !== previousFocus ||
      this.#affect.fatigue !== previousFatigue
    ) {
      this.#affectSettled = false
      this.#faceSettled = false
      this.#effectSettled = false
    }
  }

  #play(actionId: string, policy: 'replace' | 'restart' | 'ignore', requestedGain = 1): void {
    const definition = this.#requireDefinition()
    const action = definition.actions[actionId]
    if (!action) throw new TypeError(`Unknown Action ID: ${actionId}`)
    const index = layerIndex(action.layer)
    const slot = this.#slots[index]
    if (slot.active) {
      if (policy === 'ignore') return
      if (policy === 'replace' && slot.id === actionId) return
      this.#finishSlot(index, slot.id === actionId ? 'restarted' : 'replaced')
    }
    slot.active = true
    slot.id = actionId
    slot.definition = action
    slot.startedAt = this.#lastAt
    slot.gain = clamp(requestedGain, 0, 1)
    this.#activeActionCount += 1
  }

  #stopLayer(layer: ActionLayer, reason: ActionFinishReason): void {
    const index = layerIndex(layer)
    if (this.#slots[index].active) this.#finishSlot(index, reason)
  }

  #finishSlot(index: number, reason: ActionFinishReason): void {
    const slot = this.#slots[index]
    if (!slot.active) return
    if (this.#completionCount < this.#completionEvents.length) {
      const event = this.#completionEvents[this.#completionCount]
      event.actionId = slot.id
      event.layer = LAYERS[index]
      event.reason = reason
      this.#completionCount += 1
    } else {
      trace('[BehaviorEngine] action-finished queue overflow\n')
    }
    slot.active = false
    slot.id = ''
    slot.definition = null
    slot.startedAt = 0
    slot.gain = 1
    this.#activeActionCount -= 1
  }

  #drainCompletionEvents(): void {
    const definition = this.#definition
    if (!definition || this.#completionCount === 0) return
    let index = 0
    while (index < this.#completionCount && index < MAX_COMPLETION_EVENTS) {
      definition.onEvent(this.#completionEvents[index] as ActionFinishedEvent, this.#api)
      index += 1
    }
    this.#completionCount = 0
  }

  #expireActions(at: number): void {
    for (let index = 0; index < this.#slots.length; index += 1) {
      const slot = this.#slots[index]
      if (!slot.active || !slot.definition || slot.definition.loop) continue
      if (at - slot.startedAt >= slot.definition.durationMs) this.#finishSlot(index, 'completed')
    }
  }

  #deriveExpression(): BehaviorExpression {
    const thresholds = this.#requireDefinition().profile.affect.thresholds
    const { arousal, valence, fatigue } = this.#affect
    switch (this.#derivedExpression) {
      case 'pleased':
        if (valence > thresholds.happyExit) return 'pleased'
        break
      case 'distressed':
        if (valence < thresholds.negativeExit) return 'distressed'
        break
      case 'angry':
        if (valence < thresholds.negativeExit && arousal > thresholds.angryExit) return 'angry'
        break
      case 'overheated':
        if (arousal > thresholds.hotExit && valence > thresholds.hotMinimumValence) return 'overheated'
        break
      case 'sleepy':
        if (fatigue > thresholds.sleepyExit) return 'sleepy'
        break
    }
    if (fatigue >= thresholds.sleepyEnter) return 'sleepy'
    if (valence >= thresholds.happyEnter) return 'pleased'
    if (arousal >= thresholds.hotEnter && valence > thresholds.hotMinimumValence) return 'overheated'
    if (valence <= thresholds.negativeEnter && arousal >= thresholds.angryEnter) return 'angry'
    if (valence <= thresholds.negativeEnter) return 'distressed'
    return 'neutral'
  }

  #expressionIntensity(expression: BehaviorExpression): number {
    switch (expression) {
      case 'pleased':
        return clamp(this.#affect.valence, 0, 1)
      case 'distressed':
        return clamp(-this.#affect.valence, 0, 1)
      case 'angry':
        return clamp(Math.max(-this.#affect.valence, this.#affect.arousal), 0, 1)
      case 'overheated':
        return clamp(this.#affect.arousal, 0, 1)
      case 'sleepy':
        return clamp(this.#affect.fatigue, 0, 1)
      default:
        return 0
    }
  }

  #selectBaseEffect(expression: BehaviorExpression, derivedIntensity: number): void {
    const definition = this.#requireDefinition()
    const effect = definition.profile.expressions[expression].effect
    const targetOpacity = effect ? (derivedIntensity > 0 ? derivedIntensity : 1) : 0
    if (effect !== this.#effectTargetKey) {
      this.#effectTargetKey = effect
      this.#effectSettled = false
      if (effect && effect !== this.#effectKey) {
        this.#effectKey = effect
        this.#effectOpacity = 0
      }
    }
    if (targetOpacity !== this.#effectTargetOpacity) this.#effectSettled = false
    this.#effectTargetOpacity = targetOpacity
  }

  #smoothBaseFace(elapsedMs: number, intensity: number): boolean {
    const definition = this.#requireDefinition()
    const target = definition.profile.expressions[this.#derivedExpression]
    const base = definition.profile.expressions[this.#baseExpression]
    const smoothing = definition.profile.smoothingMs
    const smoothed = this.#smoothedFace
    if (!smoothed) return true
    const left = smoothed.eyes.left
    const right = smoothed.eyes.right
    const baseLeft = base.eyes.left
    const baseRight = base.eyes.right
    const targetLeft = target.eyes.left
    const targetRight = target.eyes.right
    let settled = true

    const leftOpenTarget = baseLeft.open + (targetLeft.open - baseLeft.open) * intensity
    const rightOpenTarget = baseRight.open + (targetRight.open - baseRight.open) * intensity
    if (left.open !== leftOpenTarget || right.open !== rightOpenTarget) {
      const factor = smoothingFactor(elapsedMs, smoothing.eyeOpen)
      left.open = smoothWithFactor(left.open, leftOpenTarget, factor)
      right.open = smoothWithFactor(right.open, rightOpenTarget, factor)
      if (left.open !== leftOpenTarget || right.open !== rightOpenTarget) settled = false
    }

    const leftLowerLidTarget = baseLeft.lowerLid + (targetLeft.lowerLid - baseLeft.lowerLid) * intensity
    const rightLowerLidTarget = baseRight.lowerLid + (targetRight.lowerLid - baseRight.lowerLid) * intensity
    if (left.lowerLid !== leftLowerLidTarget || right.lowerLid !== rightLowerLidTarget) {
      const factor = smoothingFactor(elapsedMs, smoothing.lowerLid)
      left.lowerLid = smoothWithFactor(left.lowerLid, leftLowerLidTarget, factor)
      right.lowerLid = smoothWithFactor(right.lowerLid, rightLowerLidTarget, factor)
      if (left.lowerLid !== leftLowerLidTarget || right.lowerLid !== rightLowerLidTarget) settled = false
    }

    const leftBrowTiltTarget = baseLeft.browTilt + (targetLeft.browTilt - baseLeft.browTilt) * intensity
    const rightBrowTiltTarget = baseRight.browTilt + (targetRight.browTilt - baseRight.browTilt) * intensity
    if (left.browTilt !== leftBrowTiltTarget || right.browTilt !== rightBrowTiltTarget) {
      const factor = smoothingFactor(elapsedMs, smoothing.browTilt)
      left.browTilt = smoothWithFactor(left.browTilt, leftBrowTiltTarget, factor)
      right.browTilt = smoothWithFactor(right.browTilt, rightBrowTiltTarget, factor)
      if (left.browTilt !== leftBrowTiltTarget || right.browTilt !== rightBrowTiltTarget) settled = false
    }

    const leftGazeXTarget = baseLeft.gazeX + (targetLeft.gazeX - baseLeft.gazeX) * intensity
    const rightGazeXTarget = baseRight.gazeX + (targetRight.gazeX - baseRight.gazeX) * intensity
    const leftGazeYTarget = baseLeft.gazeY + (targetLeft.gazeY - baseLeft.gazeY) * intensity
    const rightGazeYTarget = baseRight.gazeY + (targetRight.gazeY - baseRight.gazeY) * intensity
    if (
      left.gazeX !== leftGazeXTarget ||
      right.gazeX !== rightGazeXTarget ||
      left.gazeY !== leftGazeYTarget ||
      right.gazeY !== rightGazeYTarget
    ) {
      const factor = smoothingFactor(elapsedMs, smoothing.gaze)
      left.gazeX = smoothWithFactor(left.gazeX, leftGazeXTarget, factor)
      right.gazeX = smoothWithFactor(right.gazeX, rightGazeXTarget, factor)
      left.gazeY = smoothWithFactor(left.gazeY, leftGazeYTarget, factor)
      right.gazeY = smoothWithFactor(right.gazeY, rightGazeYTarget, factor)
      if (
        left.gazeX !== leftGazeXTarget ||
        right.gazeX !== rightGazeXTarget ||
        left.gazeY !== leftGazeYTarget ||
        right.gazeY !== rightGazeYTarget
      ) {
        settled = false
      }
    }

    const mouthOpenTarget = base.mouth.open + (target.mouth.open - base.mouth.open) * intensity
    if (smoothed.mouth.open !== mouthOpenTarget) {
      smoothed.mouth.open = smoothWithFactor(
        smoothed.mouth.open,
        mouthOpenTarget,
        smoothingFactor(elapsedMs, smoothing.mouthOpen),
      )
      if (smoothed.mouth.open !== mouthOpenTarget) settled = false
    }

    const mouthSmileTarget = base.mouth.smile + (target.mouth.smile - base.mouth.smile) * intensity
    if (smoothed.mouth.smile !== mouthSmileTarget) {
      smoothed.mouth.smile = smoothWithFactor(
        smoothed.mouth.smile,
        mouthSmileTarget,
        smoothingFactor(elapsedMs, smoothing.mouthSmile),
      )
      if (smoothed.mouth.smile !== mouthSmileTarget) settled = false
    }

    const breathAmplitudeTarget = base.breath.amplitude + (target.breath.amplitude - base.breath.amplitude) * intensity
    const breathRateTarget = base.breath.rate + (target.breath.rate - base.breath.rate) * intensity
    if (smoothed.breath.amplitude !== breathAmplitudeTarget || smoothed.breath.rate !== breathRateTarget) {
      const factor = smoothingFactor(elapsedMs, smoothing.breath)
      smoothed.breath.amplitude = smoothWithFactor(smoothed.breath.amplitude, breathAmplitudeTarget, factor)
      smoothed.breath.rate = smoothWithFactor(smoothed.breath.rate, breathRateTarget, factor)
      if (smoothed.breath.amplitude !== breathAmplitudeTarget || smoothed.breath.rate !== breathRateTarget) {
        settled = false
      }
    }
    return settled
  }

  #copySmoothedFace(output: MutableFrame): void {
    const smoothed = this.#smoothedFace
    if (!smoothed) return
    const sourceLeft = smoothed.eyes.left
    const targetLeft = output.face.eyes.left
    targetLeft.open = sourceLeft.open
    targetLeft.lowerLid = sourceLeft.lowerLid
    targetLeft.browTilt = sourceLeft.browTilt
    targetLeft.gazeX = sourceLeft.gazeX
    targetLeft.gazeY = sourceLeft.gazeY
    const sourceRight = smoothed.eyes.right
    const targetRight = output.face.eyes.right
    targetRight.open = sourceRight.open
    targetRight.lowerLid = sourceRight.lowerLid
    targetRight.browTilt = sourceRight.browTilt
    targetRight.gazeX = sourceRight.gazeX
    targetRight.gazeY = sourceRight.gazeY
    output.face.mouth.open = smoothed.mouth.open
    output.face.mouth.smile = smoothed.mouth.smile
    output.face.breath.amplitude = smoothed.breath.amplitude
    output.face.breath.rate = smoothed.breath.rate
  }

  #smoothBaseEffect(elapsedMs: number): boolean {
    const smoothing = this.#requireDefinition().profile.smoothingMs.effectOpacity
    this.#effectOpacity = clamp(smooth(this.#effectOpacity, this.#effectTargetOpacity, elapsedMs, smoothing), 0, 1)
    if (!this.#effectTargetKey && this.#effectOpacity < 1 / 255) {
      this.#effectKey = null
      this.#effectOpacity = 0
    }
    return this.#effectKey === this.#effectTargetKey && this.#effectOpacity === this.#effectTargetOpacity
  }

  #clampFace(output: MutableFrame): void {
    const left = output.face.eyes.left
    left.open = clamp(left.open, 0, 1)
    left.lowerLid = clamp(left.lowerLid, 0, 1)
    left.browTilt = clamp(left.browTilt, -1, 1)
    left.gazeX = clamp(left.gazeX, -1, 1)
    left.gazeY = clamp(left.gazeY, -1, 1)
    const right = output.face.eyes.right
    right.open = clamp(right.open, 0, 1)
    right.lowerLid = clamp(right.lowerLid, 0, 1)
    right.browTilt = clamp(right.browTilt, -1, 1)
    right.gazeX = clamp(right.gazeX, -1, 1)
    right.gazeY = clamp(right.gazeY, -1, 1)
    output.face.mouth.open = clamp(output.face.mouth.open, 0, 1)
    output.face.mouth.smile = clamp(output.face.mouth.smile, -1, 1)
    output.face.breath.amplitude = clamp(output.face.breath.amplitude, 0, 2)
    output.face.breath.rate = clamp(output.face.breath.rate, 0, 2)
  }

  #updateSpeech(at: number, elapsedMs: number): void {
    const speech = this.#requireDefinition().profile.speech
    const target = at - this.#speechLastAt > speech.holdMs ? 0 : this.#speechTarget
    const timeConstant = target > this.#speechEnvelope ? speech.attackMs : speech.releaseMs
    this.#speechEnvelope = clamp(smooth(this.#speechEnvelope, target, elapsedMs, timeConstant), 0, 1)
    if (target === 0 && this.#speechEnvelope === 0) {
      this.#speechTarget = 0
      this.#speechSettled = true
    }
  }

  #applySlot(output: MutableFrame, slot: ActionSlot, at: number): void {
    const action = slot.definition
    if (!slot.active || !action) return
    const rawElapsed = Math.max(0, at - slot.startedAt)
    const elapsed = action.loop ? rawElapsed % action.durationMs : Math.min(rawElapsed, action.durationMs)
    const weight = clamp(sampleTrack(action.weight, elapsed, 1) * slot.gain, 0, 1)
    if (action.mode) output.mode = action.mode
    if (action.expression) output.expression = action.expression
    if (weight <= 0) {
      if (action.tracks.motion) output.motion.active = true
      if (action.tracks.lighting) output.lighting.active = true
      return
    }
    const fullWeight = weight >= 1

    const face = action.tracks.face
    if (face) {
      for (let sideIndex = 0; sideIndex < EYE_SIDES.length; sideIndex += 1) {
        const side = EYE_SIDES[sideIndex]
        const tracks = face.eyes?.[side]
        if (!tracks) continue
        const eye = output.face.eyes[side]
        if (tracks.open) {
          const sampled = sampleTrack(tracks.open, elapsed, eye.open)
          eye.open = fullWeight ? sampled : eye.open + (sampled - eye.open) * weight
        }
        if (tracks.lowerLid) {
          const sampled = sampleTrack(tracks.lowerLid, elapsed, eye.lowerLid)
          eye.lowerLid = fullWeight ? sampled : eye.lowerLid + (sampled - eye.lowerLid) * weight
        }
        if (tracks.browTilt) {
          const sampled = sampleTrack(tracks.browTilt, elapsed, eye.browTilt)
          eye.browTilt = fullWeight ? sampled : eye.browTilt + (sampled - eye.browTilt) * weight
        }
        if (tracks.gazeX) {
          const sampled = sampleTrack(tracks.gazeX, elapsed, eye.gazeX)
          eye.gazeX = fullWeight ? sampled : eye.gazeX + (sampled - eye.gazeX) * weight
        }
        if (tracks.gazeY) {
          const sampled = sampleTrack(tracks.gazeY, elapsed, eye.gazeY)
          eye.gazeY = fullWeight ? sampled : eye.gazeY + (sampled - eye.gazeY) * weight
        }
      }
      if (face.mouth?.open) {
        const sampled = sampleTrack(face.mouth.open, elapsed, output.face.mouth.open)
        output.face.mouth.open = fullWeight
          ? sampled
          : output.face.mouth.open + (sampled - output.face.mouth.open) * weight
      }
      if (face.mouth?.smile) {
        const sampled = sampleTrack(face.mouth.smile, elapsed, output.face.mouth.smile)
        output.face.mouth.smile = fullWeight
          ? sampled
          : output.face.mouth.smile + (sampled - output.face.mouth.smile) * weight
      }
      if (face.breath?.amplitude) {
        const sampled = sampleTrack(face.breath.amplitude, elapsed, output.face.breath.amplitude)
        output.face.breath.amplitude = fullWeight
          ? sampled
          : output.face.breath.amplitude + (sampled - output.face.breath.amplitude) * weight
      }
      if (face.breath?.rate) {
        const sampled = sampleTrack(face.breath.rate, elapsed, output.face.breath.rate)
        output.face.breath.rate = fullWeight
          ? sampled
          : output.face.breath.rate + (sampled - output.face.breath.rate) * weight
      }
    }

    const effect = action.tracks.effect
    if (effect) {
      const sampledOpacity = clamp(sampleTrack(effect.opacity, elapsed, 0), 0, 1)
      if (effect.key === output.effect.key) {
        output.effect.opacity = fullWeight
          ? sampledOpacity
          : output.effect.opacity + (sampledOpacity - output.effect.opacity) * weight
      } else {
        const opacity = sampledOpacity * weight
        if (opacity > 0) {
          output.effect.key = effect.key
          output.effect.opacity = opacity
        }
      }
    }

    const motion = action.tracks.motion
    if (motion) {
      output.motion.active = true
      if (motion.yaw) {
        const sampled = sampleTrack(motion.yaw, elapsed, output.motion.yaw)
        output.motion.yaw = fullWeight ? sampled : output.motion.yaw + (sampled - output.motion.yaw) * weight
      }
      if (motion.pitch) {
        const sampled = sampleTrack(motion.pitch, elapsed, output.motion.pitch)
        output.motion.pitch = fullWeight ? sampled : output.motion.pitch + (sampled - output.motion.pitch) * weight
      }
      if (motion.roll) {
        const sampled = sampleTrack(motion.roll, elapsed, output.motion.roll)
        output.motion.roll = fullWeight ? sampled : output.motion.roll + (sampled - output.motion.roll) * weight
      }
    }

    const lighting = action.tracks.lighting
    if (lighting) {
      output.lighting.active = true
      if (lighting.r) {
        const sampled = sampleTrack(lighting.r, elapsed, output.lighting.r)
        output.lighting.r = fullWeight ? sampled : output.lighting.r + (sampled - output.lighting.r) * weight
      }
      if (lighting.g) {
        const sampled = sampleTrack(lighting.g, elapsed, output.lighting.g)
        output.lighting.g = fullWeight ? sampled : output.lighting.g + (sampled - output.lighting.g) * weight
      }
      if (lighting.b) {
        const sampled = sampleTrack(lighting.b, elapsed, output.lighting.b)
        output.lighting.b = fullWeight ? sampled : output.lighting.b + (sampled - output.lighting.b) * weight
      }
      output.lighting.r = clamp(output.lighting.r, 0, 1)
      output.lighting.g = clamp(output.lighting.g, 0, 1)
      output.lighting.b = clamp(output.lighting.b, 0, 1)
    }
  }
}
