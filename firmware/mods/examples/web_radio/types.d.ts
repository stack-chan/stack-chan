declare module 'behaviors/face' {
  import type { Container as PiuContainer } from 'piu/MC'
  export const RelaxedFace: { new (): PiuContainer }
}

declare module 'effects/music-notes' {
  import type { Port as PiuPort } from 'piu/MC'
  export const MusicNotes: { new (): PiuPort }
}

declare module 'capabilities' {
  import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'

  export type WebRadioState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'stalled' | 'retrying' | 'error'

  export type WebRadioCapability = {
    readonly state: WebRadioState
    start(options: {
      url: string
      volume?: number
      sampleRate?: number
      reconnect?: boolean
      onStateChanged?: (state: WebRadioState, reason?: string) => void
    }): Promise<void>
    stop(): void
    setVolume(volume: number): void
  }

  export type StackchanContext = {
    audio: { webRadio?: WebRadioCapability }
    connectivity: {
      network?: {
        ready: Promise<
          { status: 'connected' } | { status: 'skipped'; reason: string } | { status: 'failed'; reason: string }
        >
      }
    }
    drawer: {
      addDrawerButton(button: {
        key: string
        label: string
        kind: 'toggle'
        initialState: boolean
        callback: (context: StackchanContext) => unknown
      }): void
      setDrawerButtonState(key: string, active: boolean): void
    }
    ui: {
      addEffect(effect: PiuContent, key?: string): void
      removeEffect(effect: PiuContent): void
      setFace(face: PiuContainer): void
    }
    showBalloon(text: string): void
    hideBalloon(): void
  }
}
