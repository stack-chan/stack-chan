import type { AppAudio } from 'stackchan/audio'
import type { AppCamera, CameraImage } from 'stackchan/camera'
import { StackchanError } from 'stackchan/errors'
import type { AppMotion } from 'stackchan/motion'
import type { TaskHandler, Unsubscribe } from 'stackchan/task'

export type { AppAudio, PlaybackOptions } from 'stackchan/audio'

export const EMOTIONS = Object.freeze(['neutral', 'angry', 'sad', 'happy', 'sleepy', 'doubt', 'cold', 'hot'] as const)
export type Emotion = (typeof EMOTIONS)[number]
export type CapabilityId =
  | 'audio.speech'
  | 'audio.clips'
  | 'audio.tone'
  | 'audio.recording'
  | 'audio.playback'
  | 'input.primary'
  | 'input.secondary'
  | 'input.tertiary'
  | 'input.headTouch'
  | 'input.motion'
  | 'lighting'
  | 'motion'
  | 'camera'
  | 'ui.piu'
  | 'ui.controls'
  | 'settings'
  | 'network.http'
  | 'network.peer'
  | 'network.ble'
  | 'network.dnssd'
  | 'conversation.dialogue'
  | 'conversation.realtime'
  | 'conversation.remote'
  | 'audio.monitor'
  | 'audio.radio'
  | 'sensors.temperature'
  | 'motion.maintenance'
export type CapabilityStatus =
  | { readonly availability: 'native' | 'simulated' }
  | { readonly availability: 'unavailable'; readonly reason: string }

export interface AppFace {
  setEmotion(emotion: Emotion): void
  setMouthOpen(value: number): void
  setColor(part: 'primary' | 'secondary', color: { r: number; g: number; b: number }): void
}

export interface AppContext {
  readonly face: AppFace
  readonly audio: AppAudio
  readonly motion: AppMotion
  readonly camera: AppCamera
  readonly input: {
    /** Repeated presses while this handler runs are ignored. */
    onPress(name: 'primary', handler: TaskHandler): Unsubscribe
  }
  readonly time: {
    sleep(durationMs: number): Promise<void>
    /** Run once after durationMs; disposing the registration also cancels its handler. */
    after(durationMs: number, handler: TaskHandler): Unsubscribe
    /** One invocation at a time. Report handler errors and retry after intervalMs; close cancels the loop. */
    every(intervalMs: number, handler: TaskHandler): Unsubscribe
  }
  readonly ui: {
    showBalloon(text: string): void
    hideBalloon(): void
    showImage(image: CameraImage): void
    hideImage(): void
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
