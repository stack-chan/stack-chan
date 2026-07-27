import type { StackchanContext } from 'capabilities'
import type { StackchanDock, StackchanDockRuntime } from 'dock'
import config from 'mc/config'
import Modules from 'modules'
import type { RealtimeToolProvider } from 'stackchan-realtime-session'
import {
  createRemoteSessionRuntime,
  type RemoteSessionRuntime,
  type RemoteSessionTransport,
} from 'stackchan-remote-session-runtime'
import { createUsbAudioPresentation, type UsbAudioPresentation } from 'stackchan-usb-dock-presentation'
import { usbAudioConversationState } from 'stackchan-usb-dock-presentation-model'
import type { StackChanStatus } from 'stackchan-usb-media-session'
import Timer from 'timer'

type UsbAudioBridgeControl = RemoteSessionTransport & {
  setPresentation(presentation?: UsbAudioPresentation): void
  setStatusHandler(handler?: (status: StackChanStatus) => void): void
}

type UsbAudioBridgeOptions = {
  speakerVolume?: number
  diagnostics?: boolean
}

type UsbAudioConfig = UsbAudioBridgeOptions & {
  enabled?: boolean
  presentationEnabled?: boolean
}

type StartUsbAudioBridge = (options?: UsbAudioBridgeOptions) => UsbAudioBridgeControl

const stackchanUsbDock: StackchanDock = {
  start(): StackchanDockRuntime | undefined {
    const usbAudio = (config as { usbAudio?: UsbAudioConfig }).usbAudio
    if (!usbAudio?.enabled) return
    if (!Modules.has('stackchan-usb-audio')) {
      throw new Error('USB audio Dock is enabled, but the stackchan-usb-audio module is unavailable')
    }
    const startUsbAudioBridge = Modules.importNow('stackchan-usb-audio') as StartUsbAudioBridge | undefined
    if (typeof startUsbAudioBridge !== 'function') {
      throw new Error('stackchan-usb-audio does not export a bridge starter')
    }

    const bridge = startUsbAudioBridge({
      speakerVolume: usbAudio.speakerVolume,
      diagnostics: usbAudio.diagnostics,
    })
    let remoteRuntime: RemoteSessionRuntime
    try {
      remoteRuntime = createRemoteSessionRuntime(bridge, {
        set: (callback, milliseconds) => Timer.set(callback, milliseconds),
        clear: (handle) => Timer.clear(handle as Timer),
      })
    } catch (error) {
      try {
        bridge.close()
      } catch (closeError) {
        trace(`[dock] bridge close failed during startup cleanup: ${String(closeError)}\n`)
      }
      throw error
    }

    let closed = false
    let presentation: UsbAudioPresentation | undefined
    return {
      remoteConversationSession: remoteRuntime.remoteConversationSession,
      onContextCreated(context) {
        remoteRuntime.onContextCreated(context, createRealtimeToolProvider(context))
        bridge.setStatusHandler((status) => remoteRuntime.updateConversationState(usbAudioConversationState(status)))
        if (usbAudio.presentationEnabled !== false) {
          presentation = createUsbAudioPresentation(context)
          bridge.setPresentation(presentation)
        }
      },
      close() {
        if (closed) return
        closed = true
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
        attempt(() => bridge.setStatusHandler(undefined))
        attempt(() => bridge.setPresentation(undefined))
        attempt(() => presentation?.close())
        presentation = undefined
        attempt(() => remoteRuntime.close())
        if (failed) throw firstError
      },
    }
  },
}

function createRealtimeToolProvider(context: StackchanContext): RealtimeToolProvider {
  if (!Modules.has('stackchan-realtime-tools')) {
    trace('[dock] stackchan-realtime-tools is unavailable; USB session exposes Android tools only\n')
    return { tools: [] }
  }
  const createProvider = Modules.importNow('stackchan-realtime-tools') as
    | ((context: StackchanContext) => RealtimeToolProvider)
    | undefined
  if (typeof createProvider !== 'function') {
    throw new TypeError('stackchan-realtime-tools does not export a provider factory')
  }
  return createProvider(context)
}

export default stackchanUsbDock
