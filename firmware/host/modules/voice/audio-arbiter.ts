export type AudioRole = 'short-utterance' | 'realtime-conversation'

export const AudioArbiterState = Object.freeze({
  Free: 0,
  StoppingMedia: 1,
  Held: 2,
} as const)

export type AudioArbiterState = (typeof AudioArbiterState)[keyof typeof AudioArbiterState]

export class AudioArbiter {
  #state: AudioArbiterState = AudioArbiterState.Free
  #currentRole: AudioRole | undefined

  get state(): AudioArbiterState {
    return this.#state
  }

  get currentRole(): AudioRole | undefined {
    return this.#currentRole
  }

  beginAcquire(role: AudioRole): boolean {
    if (this.#state !== AudioArbiterState.Free) {
      return false
    }
    this.#state = AudioArbiterState.StoppingMedia
    this.#currentRole = role
    return true
  }

  confirmAcquire(role?: AudioRole): boolean {
    if (this.#state !== AudioArbiterState.StoppingMedia) {
      return false
    }
    if (role !== undefined && this.#currentRole !== role) {
      return false
    }
    this.#state = AudioArbiterState.Held
    return true
  }

  release(role?: AudioRole): boolean {
    if (this.#state === AudioArbiterState.Free) {
      return false
    }
    if (role !== undefined && this.#currentRole !== role) {
      return false
    }
    this.#state = AudioArbiterState.Free
    this.#currentRole = undefined
    return true
  }
}
