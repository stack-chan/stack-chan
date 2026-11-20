import loadPreferences from 'loadPreference'
import type { StackchanContext } from 'capabilities'
import { DOMAIN } from 'consts'
import type { StackchanDock } from 'dock'
import config from 'mc/config'
import Modules from 'modules'
import type { RealtimeToolProvider } from 'stackchan-realtime-session'
import { createRemoteSessionRuntime } from 'stackchan-remote-session-runtime'
import type { UsbAudioPresentation } from 'stackchan-usb-dock-presentation'
import { usbAudioConversationState } from 'stackchan-usb-dock-presentation-model'
import {
  createUsbAudioDockRuntime,
  resolveUsbAudioConfig,
  type UsbAudioBridgeControl,
  type UsbAudioConfig,
} from 'stackchan-usb-dock-runtime'
import type { StackChanStatus } from 'stackchan-usb-media-session'
import Timer from 'timer'
import { canonicalizeVolume } from 'volume-model'

const stackchanUsbDock: StackchanDock = {
  start(modConfig) {
    const usbAudio = resolveUsbAudioConfig((config as { usbAudio?: UsbAudioConfig }).usbAudio, modConfig)
    if (!usbAudio?.enabled) return
    const configuredSpeakerVolume = usbAudio.speakerVolume
    const resolveSavedSpeakerVolume = () => canonicalizeVolume(loadPreferences(DOMAIN.tts).volume)
    return createUsbAudioDockRuntime(
      {
        ...usbAudio,
        speakerVolume: configuredSpeakerVolume ?? resolveSavedSpeakerVolume(),
      },
      {
        hasUsbAudioModule() {
          return Modules.has('stackchan-usb-audio')
        },
        importUsbAudioModule() {
          return Modules.importNow('stackchan-usb-audio')
        },
        createRemoteRuntime(bridge: UsbAudioBridgeControl<StackChanStatus>) {
          return createRemoteSessionRuntime(bridge, {
            set: (callback, milliseconds) => Timer.set(callback, milliseconds),
            clear: (handle) => Timer.clear(handle as Timer),
          })
        },
        createRealtimeToolProvider,
        createPresentation: createUsbAudioDockPresentation,
        conversationState: usbAudioConversationState,
        ...(configuredSpeakerVolume === undefined ? { resolveSpeakerVolume: resolveSavedSpeakerVolume } : {}),
      },
    )
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

function createUsbAudioDockPresentation(context: StackchanContext): UsbAudioPresentation {
  if (!Modules.has('stackchan-usb-dock-presentation')) {
    throw new Error('stackchan-usb-dock-presentation is unavailable')
  }
  const createPresentation = Modules.importNow('stackchan-usb-dock-presentation') as
    | ((context: StackchanContext) => UsbAudioPresentation)
    | undefined
  if (typeof createPresentation !== 'function') {
    throw new TypeError('stackchan-usb-dock-presentation does not export a presentation factory')
  }
  return createPresentation(context)
}

export default stackchanUsbDock
