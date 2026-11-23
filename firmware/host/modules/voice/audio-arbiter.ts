export type AudioRole = 'media-playback' | 'wake-listening' | 'short-utterance' | 'realtime-conversation'

export type PreemptionDecision = 'allow' | 'stop-and-wait' | 'reject-busy' | 'reject-quarantined'

export const AudioArbiterState = Object.freeze({
  Free: 0,
  Held: 1,
  Releasing: 2,
  Quarantined: 3,
} as const)

export type AudioArbiterState = (typeof AudioArbiterState)[keyof typeof AudioArbiterState]

const CAN_PREEMPT: Readonly<Record<AudioRole, Readonly<Record<AudioRole, boolean>>>> = Object.freeze({
  'wake-listening': Object.freeze({
    'wake-listening': false,
    'media-playback': true,
    'short-utterance': true,
    'realtime-conversation': true,
  }),
  'media-playback': Object.freeze({
    'wake-listening': false,
    'media-playback': false,
    'short-utterance': true,
    'realtime-conversation': true,
  }),
  'short-utterance': Object.freeze({
    'wake-listening': false,
    'media-playback': false,
    'short-utterance': false,
    'realtime-conversation': false,
  }),
  'realtime-conversation': Object.freeze({
    'wake-listening': false,
    'media-playback': false,
    'short-utterance': false,
    'realtime-conversation': false,
  }),
})

export class AudioArbiter {
  #state: AudioArbiterState = AudioArbiterState.Free
  #currentRole: AudioRole | undefined
  #quarantineReason: string | undefined

  get state(): AudioArbiterState {
    return this.#state
  }

  get currentRole(): AudioRole | undefined {
    return this.#currentRole
  }

  get quarantineReason(): string | undefined {
    return this.#quarantineReason
  }

  resolveContention(incoming: AudioRole): PreemptionDecision {
    switch (this.#state) {
      case AudioArbiterState.Free:
        return 'allow'
      case AudioArbiterState.Quarantined:
        return 'reject-quarantined'
      case AudioArbiterState.Releasing:
        return 'reject-busy'
      case AudioArbiterState.Held:
        if (this.#currentRole !== undefined && CAN_PREEMPT[this.#currentRole][incoming]) {
          return 'stop-and-wait'
        }
        return 'reject-busy'
      default: {
        const exhaustive: never = this.#state
        return exhaustive
      }
    }
  }

  tryAcquire(role: AudioRole): PreemptionDecision {
    const decision = this.resolveContention(role)
    if (decision === 'allow') {
      this.#state = AudioArbiterState.Held
      this.#currentRole = role
    }
    return decision
  }

  beginRelease(role?: AudioRole): boolean {
    if (this.#state !== AudioArbiterState.Held) {
      return false
    }
    if (role !== undefined && this.#currentRole !== role) {
      return false
    }
    this.#state = AudioArbiterState.Releasing
    return true
  }

  confirmRelease(role?: AudioRole): boolean {
    if (this.#state !== AudioArbiterState.Releasing) {
      return false
    }
    if (role !== undefined && this.#currentRole !== role) {
      return false
    }
    this.#state = AudioArbiterState.Free
    this.#currentRole = undefined
    return true
  }

  markQuarantined(reason?: string): void {
    this.#state = AudioArbiterState.Quarantined
    this.#currentRole = undefined
    if (this.#quarantineReason === undefined && reason !== undefined) {
      this.#quarantineReason = reason
    }
  }
}
