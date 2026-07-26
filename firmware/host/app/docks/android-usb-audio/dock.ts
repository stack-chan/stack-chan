import type { StackchanContext } from 'capabilities'
import type { StackchanDock, StackchanDockRuntime } from 'dock'
import {
  createRemoteSessionRuntime,
  type RemoteSessionRuntime,
  type RemoteSessionTransport,
} from 'stackchan-remote-session-runtime'
import type { RealtimeToolProvider } from 'stackchan-realtime-session'
import config from 'mc/config'
import Modules from 'modules'
import Timer from 'timer'
import { createUsbAudioPresentation, type UsbAudioPresentation } from 'stackchan-usb-dock-presentation'

type UsbAudioBridgeControl = RemoteSessionTransport & {
  setPresentation(presentation?: UsbAudioPresentation): void
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
      bridge.close()
      throw error
    }

    let closed = false
    return {
      remoteConversationSession: remoteRuntime.remoteConversationSession,
      onContextCreated(context) {
        remoteRuntime.onContextCreated(context, createRealtimeToolProvider(context))
        if (usbAudio.presentationEnabled !== false) {
          bridge.setPresentation(
            createUsbAudioPresentation(context, (state) => remoteRuntime.updateConversationState(state)),
          )
        }
      },
      close() {
        if (closed) return
        closed = true
        let firstError: unknown
        let hasError = false
        try {
          bridge.setPresentation(undefined)
        } catch (error) {
          firstError = error
          hasError = true
        }
        try {
          remoteRuntime.close()
        } catch (error) {
          if (!hasError) {
            firstError = error
            hasError = true
          }
        }
        if (hasError) throw firstError
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
