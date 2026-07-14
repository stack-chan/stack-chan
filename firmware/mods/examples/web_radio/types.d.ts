declare module 'effects/music-notes' {
  import type { Container as PiuContainer } from 'piu/MC'
  export const MusicNotes: { new (): PiuContainer }
}

declare module 'capabilities' {
  import type { Content as PiuContent } from 'piu/MC'

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
        kind: 'choice'
        value: string
        options: { value: string; label: string }[]
        callback: (context: StackchanContext, value?: string) => unknown
      }): void
    }
    ui: {
      application?: {
        distribute?(event: 'onConnectionIndicator', visible: boolean): void
      }
      addEffect(effect: PiuContent, key?: string): void
      removeEffect(effect: PiuContent): void
      setFaceMotionEnabled?(enabled: boolean): void
    }
    showBalloon(text: string): void
    hideBalloon(): void
  }
}
