import loadPreferences, { loadModConfig, loadPreferenceConfig } from 'loadPreference'
import System from 'embedded:system'
import { runContextCreatedBehaviors, type StackchanAppBehavior } from 'app-behavior'
import { resolveAppBehaviors } from 'app-behavior-resolver'
import defaultBehavior from 'app-default-behavior'
import { installLaunchShortcut, type LaunchShortcutButton, prepareAppLaunch } from 'app-launch'
import { type BootWiFiStatus, startHostBootServices } from 'boot-services'
import type { StackchanContext } from 'capabilities'
import { createStackchanContext, getHostDeviceEnvironment } from 'compose'
import { DOMAIN } from 'consts'
import { type StackchanDockRuntime, startStackchanDock } from 'dock'
import { prepareExperimentalMiniApps, registerExperimentalMiniApps } from 'experimental-mini-app-loader'
import { initializeLocalization } from 'localization'
import Modules from 'modules'
import {
  type StartupPhase,
  showStartupError,
  showStartupSplash,
  showWiFiConnectionStatus,
  showWiFiRecoveryChoice,
  startupErrorClass,
} from 'startup-splash'
import { applyTimezone } from 'timezone-settings'

type DeviceButton = {
  onChanged: (this: DeviceButton) => void
}

type GlobalEnvironment = {
  application?: ReturnType<typeof showStartupSplash>
  button?: Partial<Record<'a' | 'c', DeviceButton>> & { power?: LaunchShortcutButton }
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment
const noopButtonHandler = () => undefined

function installPlatformInputBridge(): void {
  if (!Modules.has('wasm-button-bridge')) return
  const bridge = Modules.importNow('wasm-button-bridge') as { installWasmButtons?: () => void }
  bridge.installWasmButtons?.()
  trace('[main] installed WASM button bridge\n')
}

function loadAppBehaviors(): StackchanAppBehavior[] {
  trace('[main] checking mod override\n')
  return resolveAppBehaviors(Modules, defaultBehavior, (error) => {
    trace(`[main] MOD override unavailable: ${startupErrorClass(error)}\n`)
  })
}

function installModManagerShortcut(): void {
  const powerButton = globalEnv.button?.power
  if (!powerButton || !Modules.has('mod-manager')) return
  installLaunchShortcut(powerButton, async () => {
    try {
      const startModManager = Modules.importNow('mod-manager') as (
        application: ReturnType<typeof showStartupSplash>,
      ) => Promise<'back'>
      await startModManager(globalEnv.application ?? showStartupSplash())
      System.restart?.()
    } catch (error) {
      trace(`[mods] shortcut failed: ${startupErrorClass(error)}\n`)
    }
  })
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
  let phase: StartupPhase = 'initialization'
  try {
    dockRuntime = startStackchanDock(Modules, loadModConfig())
    if (dockRuntime) trace('[main] Stackchan Dock started\n')
    installPlatformInputBridge()
    initializeLocalization(loadPreferences(DOMAIN.ui).language)
    applyTimezone(loadPreferences(DOMAIN.time).timezone)

    trace('[main] loading app behaviors\n')
    const appBehaviors = loadAppBehaviors()
    // Launch behaviors run before startHostBootServices so the splash screen is
    // visible while network setup blocks.
    phase = 'launch'
    const launch = await prepareAppLaunch(appBehaviors, prepareExperimentalMiniApps)
    trace(`[main] onLaunch shouldCreateContext=${launch.shouldCreateContext}\n`)
    if (!launch.shouldCreateContext) {
      installModManagerShortcut()
      const unownedDock = dockRuntime
      dockRuntime = undefined
      unownedDock?.close()
      return
    }
    const experimentalMiniApps = launch.prepared

    phase = 'network'
    const bootServices = startHostBootServices({
      wifi: {
        onStatusChanged: showWiFiConnectionStatus,
        promptRecoveryChoice: waitForBootWiFiRecoveryChoice,
      },
    })
    const networkReady = await bootServices.connectivity.network.ready
    trace(`[main] network ready: ${networkReady.status}\n`)
    phase = 'context'
    const preferences = loadPreferenceConfig()
    const ownedDock = dockRuntime
    context = createStackchanContext(preferences, {
      connectivity: bootServices.connectivity,
      remoteConversationSession: ownedDock?.remoteConversationSession,
      closeHandlers: ownedDock ? [() => ownedDock.close()] : undefined,
    })
    phase = 'behavior'
    ownedDock?.onContextCreated(context)
    registerExperimentalMiniApps(experimentalMiniApps, context.ui.miniApps)
    trace('[main] app context created\n')
    await runContextCreatedBehaviors(appBehaviors, context, {
      device: getHostDeviceEnvironment(),
      config: preferences,
    })
    trace('[main] app behaviors ready\n')
    installModManagerShortcut()
  } catch (error) {
    // A newer/disposed view during async cleanup owns its screen. Do not
    // replace it with an older startup attempt's failure.
    const failedApplication = globalEnv.application
    const failedBehavior = failedApplication?.behavior
    const failedContent = failedApplication?.first
    try {
      if (context) await context.lifecycle.close()
      else dockRuntime?.close()
    } catch (closeError) {
      trace(`[main] cleanup error ${startupErrorClass(closeError)}\n`)
    }
    trace(`[main] startup failed phase=${phase} error=${startupErrorClass(error)}\n`)
    if (
      globalEnv.application === failedApplication &&
      (!failedApplication ||
        (failedApplication.behavior === failedBehavior && failedApplication.first === failedContent))
    ) {
      try {
        showStartupError({ phase, error, onRestart: () => System.restart?.() })
        installModManagerShortcut()
      } catch (displayError) {
        trace(`[main] startup error display failed ${startupErrorClass(displayError)}\n`)
      }
    }
    throw error
  }
}

void main().catch(() => undefined)
