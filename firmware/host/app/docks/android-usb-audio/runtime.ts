import type {
  RemoteConversationSession,
  RemoteConversationSessionDelegate,
  RemoteConversationState,
  StackchanContext,
} from 'capabilities'
import type { TaskExecutionState } from 'stackchan-application-event'
import type { RealtimeToolProvider } from 'stackchan-realtime-session'
import {
  createRemoteConversationSessionFacade,
  type RemoteConversationSessionBinding,
} from 'stackchan-remote-session-facade'

export type UsbAudioPresentationControl = {
  onStatusChanged(status: number): void
  onTaskStateChanged(state: TaskExecutionState): void
  onPlaybackStarted(): void
  onPlaybackPower(power: number): void
  onPlaybackText(text: string): void
  onPlaybackStopped(): void
  close(): void
}

export type UsbAudioBridgeControl<Status> = {
  setSpeakerVolume(volume: number): void
  setEventHandler(handler?: (event: string) => void): void
  setTransportStateHandler(handler?: (state: 'disconnected' | 'unsupported' | 'ready') => void): void
  sendEvent(event: string): Promise<'queued' | 'overflow' | 'disconnected' | 'unsupported'>
  close(): void
  setPresentation(presentation?: UsbAudioPresentationControl): void
  setStatusHandler(handler?: (status: Status) => void): void
}

export type UsbAudioBridgeOptions = {
  speakerVolume?: number
  diagnostics?: boolean
}

export type UsbAudioConfig = UsbAudioBridgeOptions & {
  enabled?: boolean
  autoStart?: boolean
  presentationEnabled?: boolean
}

type StartUsbAudioBridge<Status> = (options?: UsbAudioBridgeOptions) => UsbAudioBridgeControl<Status>

export type UsbAudioRemoteRuntime = {
  readonly remoteConversationSession: RemoteConversationSessionDelegate
  onContextCreated(context: StackchanContext, provider: RealtimeToolProvider): void
  updateConversationState(state: RemoteConversationState, error?: string): void
  subscribeTaskState(listener: (state: TaskExecutionState) => void): () => void
  close(): void
}

export type UsbAudioDockRuntime = {
  readonly remoteConversationSession?: RemoteConversationSession
  onContextCreated(context: StackchanContext): void
  close(): void
}

export type UsbAudioDockDependencies<Status> = {
  hasUsbAudioModule(): boolean
  importUsbAudioModule(): unknown
  createRemoteRuntime(bridge: UsbAudioBridgeControl<Status>): UsbAudioRemoteRuntime
  createRealtimeToolProvider(context: StackchanContext): RealtimeToolProvider
  createPresentation(context: StackchanContext): UsbAudioPresentationControl
  conversationState(status: Status): RemoteConversationState
  resolveSpeakerVolume?(): number
}

export function createUsbAudioDockRuntime<Status>(
  usbAudio: UsbAudioConfig,
  dependencies: UsbAudioDockDependencies<Status>,
): UsbAudioDockRuntime {
  if (!dependencies.hasUsbAudioModule()) {
    throw new Error('USB audio Dock is enabled, but the stackchan-usb-audio module is unavailable')
  }
  const startUsbAudioBridge = dependencies.importUsbAudioModule()
  if (typeof startUsbAudioBridge !== 'function') {
    throw new Error('stackchan-usb-audio does not export a bridge starter')
  }
  // USBSerial installs native RX/TX rings from internal RAM. Reserve that
  // physical transport while boot memory is still contiguous. The EVENT
  // runtime shares its lifetime so pre-activation task snapshots are retained;
  // context binding and presentation remain activation-gated below.
  const bridge = (startUsbAudioBridge as StartUsbAudioBridge<Status>)({
    speakerVolume: usbAudio.speakerVolume,
    diagnostics: usbAudio.diagnostics,
  })
  let remoteRuntime: UsbAudioRemoteRuntime
  try {
    // Keep application EVENT routing alive with the physical transport so a
    // task snapshot received before MOD activation is not lost.
    remoteRuntime = dependencies.createRemoteRuntime(bridge)
  } catch (error) {
    try {
      bridge.close()
    } catch (closeError) {
      log(`[dock] bridge close failed during startup cleanup: ${errorMessage(closeError)}\n`)
    }
    throw error
  }
  let context: StackchanContext | undefined
  let contextAttached = false
  let remoteRuntimeContextAttached = false
  let closed = false
  const facade = createRemoteConversationSessionFacade(createActiveBinding)

  function createActiveBinding(): RemoteConversationSessionBinding {
    if (!contextAttached || !context) {
      throw new Error('USB audio Dock cannot activate before the Stack-chan context is attached')
    }

    let presentation: UsbAudioPresentationControl | undefined
    let removeTaskStateListener: (() => void) | undefined
    try {
      if (!remoteRuntimeContextAttached) {
        remoteRuntime.onContextCreated(context, dependencies.createRealtimeToolProvider(context))
        remoteRuntimeContextAttached = true
      }
      bridge.setStatusHandler((status) => remoteRuntime.updateConversationState(dependencies.conversationState(status)))
      if (usbAudio.presentationEnabled !== false) {
        presentation = dependencies.createPresentation(context)
        bridge.setPresentation(presentation)
        removeTaskStateListener = remoteRuntime.subscribeTaskState((state) => presentation?.onTaskStateChanged(state))
      }
    } catch (error) {
      try {
        closeActiveResources(bridge, presentation, removeTaskStateListener)
      } catch (closeError) {
        log(`[dock] activation cleanup failed: ${errorMessage(closeError)}\n`)
      }
      throw error
    }

    const activePresentation = presentation
    const removeActiveTaskStateListener = removeTaskStateListener
    let activeClosed = false
    return {
      remoteSession: remoteRuntime.remoteConversationSession,
      close() {
        if (activeClosed) return
        activeClosed = true
        closeActiveResources(bridge, activePresentation, removeActiveTaskStateListener)
      },
    }
  }

  return {
    remoteConversationSession: facade.remoteSession,
    onContextCreated(nextContext) {
      if (closed) throw new Error('USB audio Dock runtime is closed')
      if (contextAttached) throw new Error('USB audio Dock context is already attached')
      if (dependencies.resolveSpeakerVolume) {
        bridge.setSpeakerVolume(dependencies.resolveSpeakerVolume())
      }
      context = nextContext
      contextAttached = true
      if (usbAudio.autoStart) {
        try {
          facade.remoteSession.activate()
        } catch (error) {
          log(`[dock] auto-start activation failed: ${errorMessage(error)}\n`)
        }
      }
    },
    close() {
      if (closed) return
      closed = true
      context = undefined
      let firstError: unknown
      try {
        facade.close()
      } catch (error) {
        firstError = error
      }
      try {
        remoteRuntime.close()
      } catch (error) {
        firstError ??= error
      }
      try {
        bridge.close()
      } catch (error) {
        firstError ??= error
      }
      if (firstError !== undefined) throw firstError
    },
  }
}

function closeActiveResources<Status>(
  bridge: UsbAudioBridgeControl<Status> | undefined,
  presentation: UsbAudioPresentationControl | undefined,
  removeTaskStateListener?: () => void,
): void {
  let firstError: unknown
  let failed = false
  const attempt = (operation: () => void) => {
    try {
      operation()
    } catch (error) {
      if (!failed) firstError = error
      failed = true
    }
  }

  if (bridge) {
    attempt(() => bridge.setStatusHandler(undefined))
    attempt(() => bridge.setPresentation(undefined))
  }
  if (removeTaskStateListener) attempt(removeTaskStateListener)
  if (presentation) attempt(() => presentation.close())
  if (failed) throw firstError
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}
