import { StackchanError } from 'stackchan/errors'
import type { OperationOptions, TaskHandler, Unsubscribe } from 'stackchan/task'

export type Emotion = 'neutral' | 'happy' | 'angry' | 'sad' | 'sleepy' | 'doubt' | 'cold' | 'hot'
export type CapabilityId = 'audio.speech' | 'audio.clips' | 'audio.tone' | 'input.primary'
export type CapabilityStatus =
  | { readonly availability: 'native' | 'simulated' }
  | { readonly availability: 'unavailable'; readonly reason: string }

export interface AppFace {
  setEmotion(emotion: Emotion): void
  setMouthOpen(value: number): void
  setColor(part: 'primary' | 'secondary', color: { r: number; g: number; b: number }): void
}

export type PlaybackOptions = OperationOptions & { volume?: number }
export interface AppAudio {
  /** Speak natural language. Resource names belong to playClip. */
  say(text: string, options?: PlaybackOptions): Promise<void>
  playClip(name: string, options?: PlaybackOptions): Promise<void>
  tone(hz: number, options: PlaybackOptions & { durationMs: number }): Promise<void>
}

export interface AppContext {
  readonly face: AppFace
  readonly audio: AppAudio
  readonly input: {
    /** Repeated presses while this handler runs are ignored. */
    onPress(name: 'primary', handler: TaskHandler): Unsubscribe
  }
  readonly time: {
    sleep(durationMs: number): Promise<void>
    /** One invocation at a time; wait intervalMs after each completion. */
    every(intervalMs: number, handler: TaskHandler): Unsubscribe
  }
  readonly ui: {
    showBalloon(text: string): void
    hideBalloon(): void
  }
  readonly capabilities: { get(id: CapabilityId): CapabilityStatus }
}

// biome-ignore lint/suspicious/noConfusingVoidType: Async setup can return a disposer or no value.
export type AppSetup = (app: AppContext) => void | Unsubscribe | Promise<void | Unsubscribe>
export type AppDefinition = Readonly<{ apiVersion: 2; setup: AppSetup }>

/** JavaScript apps receive contextual types without repeating host implementation types. */
export function defineApp(definition: { setup: AppSetup }): AppDefinition {
  if (!definition || typeof definition.setup !== 'function') {
    throw new StackchanError('INVALID_ARGUMENT', 'An app needs a setup function')
  }
  return Object.freeze({ apiVersion: 2, setup: definition.setup })
}
