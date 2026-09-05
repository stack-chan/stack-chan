import loadPreferences, { loadModConfig, loadPreferenceConfig } from 'loadPreference'
import { runContextCreatedBehaviors, type StackchanAppBehavior } from 'app-behavior'
import { resolveAppProgram } from 'app-behavior-resolver'
import defaultBehavior from 'app-default-behavior'
import { installLaunchShortcut, type LaunchShortcutButton, prepareAppLaunch } from 'app-launch'
import { type BootWiFiStatus, startHostBootServices } from 'boot-services'
import { createStackchanContext, getHostDeviceEnvironment } from 'compose'
import { DOMAIN } from 'consts'
import { type StackchanDockRuntime, startStackchanDock } from 'dock'
import { prepareExperimentalMiniApps, registerExperimentalMiniApps } from 'experimental-mini-app-loader'
import { initializeLocalization } from 'localization'
import Modules from 'modules'
import type { StackchanRuntimeContext } from 'runtime-context'
import { showStartupSplash, showWiFiConnectionStatus, showWiFiRecoveryChoice } from 'startup-splash'
import { applyTimezone } from 'timezone-settings'

type DeviceButton = {
  onChanged: (this: DeviceButton) => void
}

type GlobalEnvironment = {
  application?: ReturnType<typeof showStartupSplash>
  button?: Partial<Record<'a' | 'c', DeviceButton>> & { power?: LaunchShortcutButton }
  System: { restart(): void }
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment
const noopButtonHandler = () => undefined

function installPlatformInputBridge(): void {
  if (!Modules.has('wasm-button-bridge')) return
  const bridge = Modules.importNow('wasm-button-bridge') as { installWasmButtons?: () => void }
  bridge.installWasmButtons?.()
  trace('[main] installed WASM button bridge\n')
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
      globalEnv.System.restart()
    } catch (error) {
      trace(`[mods] shortcut failed: ${error instanceof Error ? error.message : String(error)}\n`)
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
  let context: StackchanRuntimeContext | undefined
  try {
    dockRuntime = startStackchanDock(Modules, loadModConfig())
    if (dockRuntime) trace('[main] Stackchan Dock started\n')
    installPlatformInputBridge()
    initializeLocalization(loadPreferences(DOMAIN.ui).language)
    applyTimezone(loadPreferences(DOMAIN.time).timezone)

    trace('[main] loading app behaviors\n')
    const program = resolveAppProgram(Modules, defaultBehavior)
    const appBehaviors: StackchanAppBehavior[] =
      program.generation === 1 ? program.behaviors : [{ onLaunch: defaultBehavior.onLaunch }]
    // Launch behaviors run before startHostBootServices so the splash screen is
    // visible while network setup blocks.
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

    const bootServices = startHostBootServices({
      wifi:
        program.generation === 1
          ? {
              onStatusChanged: showWiFiConnectionStatus,
              promptRecoveryChoice: waitForBootWiFiRecoveryChoice,
            }
          : undefined,
    })
    if (program.generation === 1) {
      const networkReady = await bootServices.connectivity.network.ready
      trace(`[main] network ready: ${networkReady.status}\n`)
    } else {
      void bootServices.connectivity.network.ready.then((result) => trace(`[network] ${result.status}\n`))
    }
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
    if (program.generation === 2) await context.startApp(program.app)
    else
      await runContextCreatedBehaviors(appBehaviors, context, {
        device: getHostDeviceEnvironment(),
        config: preferences,
      })
    trace('[main] app behaviors ready\n')
    installModManagerShortcut()
  } catch (error) {
    try {
      if (context) await context.lifecycle.close()
      else dockRuntime?.close()
    } catch (closeError) {
      trace(`[main] cleanup error ${closeError instanceof Error ? closeError.message : String(closeError)}\n`)
    }
    installModManagerShortcut()
    throw error
  }
}

main().catch((error) => {
  trace(`[main] error ${error?.message ?? error}\n`)
})
