import loadPreferences, { loadPreferenceConfig } from 'loadPreference'
import { runContextCreatedBehaviors, runLaunchBehaviors, type StackchanAppBehavior } from 'app-behavior'
import { resolveAppBehaviors } from 'app-behavior-resolver'
import defaultBehavior from 'app-default-behavior'
import { type BootWiFiStatus, startHostBootServices } from 'boot-services'
import { createStackchanContext, getHostDeviceEnvironment } from 'compose'
import { DOMAIN } from 'consts'
import { prepareExperimentalMiniApps, registerExperimentalMiniApps } from 'experimental-mini-app-loader'
import { initializeLocalization } from 'localization'
import config from 'mc/config'
import Modules from 'modules'
import { showWiFiConnectionStatus, showWiFiRecoveryChoice } from 'startup-splash'
import { createUsbApprovalSession } from 'usb-approval-session'
import { createUsbAudioPresentation, type UsbAudioPresentation } from 'usb-audio-presentation'
import { createUsbRealtimeSession, type RealtimeToolProvider } from 'usb-realtime-session'
import type { StackchanContext } from 'capabilities'

type DeviceButton = {
  onChanged: (this: DeviceButton) => void
}

type GlobalEnvironment = {
  button?: Partial<Record<'a' | 'c', DeviceButton>>
}

type UsbAudioBridgeControl = {
  setPresentation(presentation?: UsbAudioPresentation): void
  setEventHandler(handler?: (event: string) => void): void
  sendEvent(event: string): void
  close(): void
}

type UsbAudioBridgeOptions = {
  speakerVolume?: number
  diagnostics?: boolean
}

type UsbAudioConfig = UsbAudioBridgeOptions & {
  enabled?: boolean
  presentationEnabled?: boolean
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment
const noopButtonHandler = () => undefined

function installPlatformInputBridge(): void {
  if (!Modules.has('wasm-button-bridge')) return
  const bridge = Modules.importNow('wasm-button-bridge') as { installWasmButtons?: () => void }
  bridge.installWasmButtons?.()
  trace('[main] installed WASM button bridge\n')
}

function startConfiguredUsbAudioBridge(): UsbAudioBridgeControl | undefined {
  const usbAudio = (config as { usbAudio?: UsbAudioConfig }).usbAudio
  if (!usbAudio?.enabled) return
  if (!Modules.has('stackchan-usb-audio')) {
    throw new Error('USB audio is enabled, but the stackchan-usb-audio module is unavailable')
  }
  const startUsbAudioBridge = Modules.importNow('stackchan-usb-audio') as
    | ((options?: UsbAudioBridgeOptions) => UsbAudioBridgeControl)
    | undefined
  if (typeof startUsbAudioBridge !== 'function') {
    throw new Error('stackchan-usb-audio does not export a bridge starter')
  }
  const bridge = startUsbAudioBridge({
    speakerVolume: usbAudio.speakerVolume,
    diagnostics: usbAudio.diagnostics,
  })
  trace('[main] USB audio bridge started\n')
  return bridge
}

function loadAppBehaviors(miniAppArchivePresent: boolean): StackchanAppBehavior[] {
  trace('[main] checking mod override\n')
  if (miniAppArchivePresent) {
    trace('[main] miniapp archive present; host-realm mod override disabled\n')
  }
  return resolveAppBehaviors(Modules, defaultBehavior, { allowModOverride: !miniAppArchivePresent })
}

function waitForBootWiFiRecoveryChoice(status: BootWiFiStatus & { reason: string }): Promise<'retry' | 'offline'> {
  return new Promise((resolve) => {
    let resolved = false
    const previousAHandler = globalEnv.button?.a?.onChanged
    const previousCHandler = globalEnv.button?.c?.onChanged

    const restoreButtons = () => {
      if (globalEnv.button?.a) {
        globalEnv.button.a.onChanged = previousAHandler ?? noopButtonHandler
      }
      if (globalEnv.button?.c) {
        globalEnv.button.c.onChanged = previousCHandler ?? noopButtonHandler
      }
    }
    const choose = (choice: 'retry' | 'offline') => {
      if (resolved) return
      resolved = true
      restoreButtons()
      resolve(choice)
    }

    trace(`[network] ${status.message}: ${status.reason}\n`)
    showWiFiRecoveryChoice({
      message: status.message,
      onRetry: () => choose('retry'),
      onOffline: () => choose('offline'),
    })
    if (globalEnv.button?.a) {
      globalEnv.button.a.onChanged = () => choose('retry')
    }
    if (globalEnv.button?.c) {
      globalEnv.button.c.onChanged = () => choose('offline')
    }
  })
}

async function main() {
  trace('[main] start\n')
  const usbAudioBridge = startConfiguredUsbAudioBridge()
  const usbRealtimeSession = usbAudioBridge ? createUsbRealtimeSession(usbAudioBridge) : undefined
  installPlatformInputBridge()
  initializeLocalization(loadPreferences(DOMAIN.ui).language)
  const miniAppArchivePresent = Modules.has('miniapp')
  const experimentalMiniApps = prepareExperimentalMiniApps()

  trace('[main] loading app behaviors\n')
  const appBehaviors = loadAppBehaviors(miniAppArchivePresent)
  // Launch behaviors run before startHostBootServices so the splash screen is
  // visible while network setup blocks.
  const shouldCreateContext = await runLaunchBehaviors(appBehaviors)
  trace(`[main] onLaunch shouldCreateContext=${shouldCreateContext}\n`)
  if (!shouldCreateContext) return

  const bootServices = startHostBootServices({
    wifi: {
      onStatusChanged: showWiFiConnectionStatus,
      promptRecoveryChoice: waitForBootWiFiRecoveryChoice,
    },
  })
  const networkReady = await bootServices.connectivity.network.ready
  trace(`[main] network ready: ${networkReady.status}\n`)
  const preferences = loadPreferenceConfig()
  const context = createStackchanContext(preferences, { connectivity: bootServices.connectivity })
  if (usbRealtimeSession) {
    const usbApprovalSession = createUsbApprovalSession(usbRealtimeSession, context)
    usbRealtimeSession.setApplicationEventHandler(usbApprovalSession.handleEvent)
  }
  if ((config as { usbAudio?: UsbAudioConfig }).usbAudio?.presentationEnabled !== false) {
    usbAudioBridge?.setPresentation(createUsbAudioPresentation(context))
  }
  if (Modules.has('stackchan-realtime-tools')) {
    const createProvider = Modules.importNow('stackchan-realtime-tools') as
      | ((context: StackchanContext) => RealtimeToolProvider)
      | undefined
    if (typeof createProvider === 'function') usbRealtimeSession?.setProvider(createProvider(context))
  } else {
    usbRealtimeSession?.setProvider({ tools: [] })
    trace('[main] stackchan-realtime-tools is unavailable; USB session exposes Android tools only\n')
  }
  registerExperimentalMiniApps(experimentalMiniApps, context.ui.miniApps)
  trace('[main] app context created\n')
  await runContextCreatedBehaviors(appBehaviors, context, {
    device: getHostDeviceEnvironment(),
    config: preferences,
  })
  trace('[main] app behaviors ready\n')
}

main().catch((error) => {
  trace(`[main] error ${error?.message ?? error}\n`)
})
