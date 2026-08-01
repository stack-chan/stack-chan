import loadPreferences, { loadPreferenceConfig } from 'loadPreference'
import { runContextCreatedBehaviors, type StackchanAppBehavior } from 'app-behavior'
import { resolveAppBehaviors } from 'app-behavior-resolver'
import defaultBehavior from 'app-default-behavior'
import { prepareAppLaunch } from 'app-launch'
import { type BootWiFiStatus, startHostBootServices } from 'boot-services'
import type { StackchanContext } from 'capabilities'
import { createStackchanContext, getHostDeviceEnvironment } from 'compose'
import { DOMAIN } from 'consts'
import { type StackchanDockRuntime, startStackchanDock } from 'dock'
import { prepareExperimentalMiniApps, registerExperimentalMiniApps } from 'experimental-mini-app-loader'
import { initializeLocalization } from 'localization'
import Modules from 'modules'
import { showWiFiConnectionStatus, showWiFiRecoveryChoice } from 'startup-splash'
import { applyTimezone } from 'timezone-settings'

type DeviceButton = {
  onChanged: (this: DeviceButton) => void
}

type GlobalEnvironment = {
  button?: Partial<Record<'a' | 'c', DeviceButton>>
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment
const noopButtonHandler = () => undefined

function traceResetReason(): void {
  if (!Modules.has('resetReason')) return
  try {
    const getResetReason = Modules.importNow('resetReason') as () => {
      reason?: number
      string?: string
    }
    const result = getResetReason()
    trace(`[main] reset reason=${result?.reason ?? 'unknown'} (${result?.string ?? 'unknown'})\n`)
  } catch (error) {
    trace(`[main] reset reason unavailable: ${error?.message ?? error}\n`)
  }
}

function installPlatformInputBridge(): void {
  if (!Modules.has('wasm-button-bridge')) return
  const bridge = Modules.importNow('wasm-button-bridge') as { installWasmButtons?: () => void }
  bridge.installWasmButtons?.()
  trace('[main] installed WASM button bridge\n')
}

function loadAppBehaviors(): StackchanAppBehavior[] {
  trace('[main] checking mod override\n')
  return resolveAppBehaviors(Modules, defaultBehavior)
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
  traceResetReason()
  let dockRuntime: StackchanDockRuntime | undefined
  let context: StackchanContext | undefined
  try {
    dockRuntime = startStackchanDock(Modules)
    if (dockRuntime) trace('[main] Stackchan Dock started\n')
    installPlatformInputBridge()
    initializeLocalization(loadPreferences(DOMAIN.ui).language)
    applyTimezone(loadPreferences(DOMAIN.time).timezone)

    trace('[main] loading app behaviors\n')
    const appBehaviors = loadAppBehaviors()
    // Launch behaviors run before startHostBootServices so the splash screen is
    // visible while network setup blocks.
    const launch = await prepareAppLaunch(appBehaviors, prepareExperimentalMiniApps)
    trace(`[main] onLaunch shouldCreateContext=${launch.shouldCreateContext}\n`)
    if (!launch.shouldCreateContext) {
      const unownedDock = dockRuntime
      dockRuntime = undefined
      unownedDock?.close()
      return
    }
    const experimentalMiniApps = launch.prepared

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
