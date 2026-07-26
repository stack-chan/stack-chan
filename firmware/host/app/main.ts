import loadPreferences, { loadPreferenceConfig } from 'loadPreference'
import { runContextCreatedBehaviors, runLaunchBehaviors, type StackchanAppBehavior } from 'app-behavior'
import { resolveAppBehaviors } from 'app-behavior-resolver'
import defaultBehavior from 'app-default-behavior'
import { type BootWiFiStatus, startHostBootServices } from 'boot-services'
import { createStackchanContext, getHostDeviceEnvironment } from 'compose'
import { DOMAIN } from 'consts'
import { startStackchanDock, type StackchanDockRuntime } from 'dock'
import { prepareExperimentalMiniApps, registerExperimentalMiniApps } from 'experimental-mini-app-loader'
import { initializeLocalization } from 'localization'
import Modules from 'modules'
import { showWiFiConnectionStatus, showWiFiRecoveryChoice } from 'startup-splash'
import type { StackchanContext } from 'capabilities'

type DeviceButton = {
  onChanged: (this: DeviceButton) => void
}

type GlobalEnvironment = {
  button?: Partial<Record<'a' | 'c', DeviceButton>>
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment
const noopButtonHandler = () => undefined

function installPlatformInputBridge(): void {
  if (!Modules.has('wasm-button-bridge')) return
  const bridge = Modules.importNow('wasm-button-bridge') as { installWasmButtons?: () => void }
  bridge.installWasmButtons?.()
  trace('[main] installed WASM button bridge\n')
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
  let dockRuntime: StackchanDockRuntime | undefined
  let context: StackchanContext | undefined
  try {
    dockRuntime = startStackchanDock(Modules)
    if (dockRuntime) trace('[main] Stackchan Dock started\n')
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
    if (!shouldCreateContext) {
      const unownedDock = dockRuntime
      dockRuntime = undefined
      unownedDock?.close()
      return
    }

    const bootServices = startHostBootServices({
      wifi: {
        onStatusChanged: showWiFiConnectionStatus,
        promptRecoveryChoice: waitForBootWiFiRecoveryChoice,
      },
    })
    const networkReady = await bootServices.connectivity.network.ready
    trace(`[main] network ready: ${networkReady.status}\n`)
    const preferences = loadPreferenceConfig()
    const ownedDock = dockRuntime
    context = createStackchanContext(preferences, {
      connectivity: bootServices.connectivity,
      remoteConversationSession: ownedDock?.remoteConversationSession,
      closeHandlers: ownedDock ? [() => ownedDock.close()] : undefined,
    })
    ownedDock?.onContextCreated(context)
    registerExperimentalMiniApps(experimentalMiniApps, context.ui.miniApps)
    trace('[main] app context created\n')
    await runContextCreatedBehaviors(appBehaviors, context, {
      device: getHostDeviceEnvironment(),
      config: preferences,
    })
    trace('[main] app behaviors ready\n')
  } catch (error) {
    try {
      if (context) await context.lifecycle.close()
      else dockRuntime?.close()
    } catch (closeError) {
      trace(`[main] cleanup error ${closeError instanceof Error ? closeError.message : String(closeError)}\n`)
    }
    throw error
  }
}

main().catch((error) => {
  trace(`[main] error ${error?.message ?? error}\n`)
})
