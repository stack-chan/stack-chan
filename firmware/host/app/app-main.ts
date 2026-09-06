import { getHostSettingsService, loadModConfig, loadPreferenceConfig } from 'loadPreference'
import { resolveAppProgram } from 'app-behavior-resolver'
import { installLaunchShortcut, type LaunchShortcutButton } from 'app-launch'
import { requestBootRecoveryChoice } from 'boot-recovery-choice'
import { startHostBootServices } from 'boot-services'
import { createStackchanContext, getHostDeviceEnvironment } from 'compose'
import defaultApp from 'default-app/main'
import { type StackchanDockRuntime, startStackchanDock } from 'dock'
import { runHostStartup } from 'host-startup'
import verifyInstalledMod from 'installed-mod'
import { initializeLocalization, localize } from 'localization'
import config from 'mc/config'
import { isModMaintenanceActive, restartInModMaintenance } from 'mod-maintenance'
import Modules from 'modules'
import { ResourceScope } from 'owned-resources'
import type { StackchanRuntimeContext } from 'runtime-context'
import { startSetupMode } from 'setup-mode'
import { showStartupFailure, showStartupSplash, showWiFiConnectionStatus, showWiFiRecoveryChoice } from 'startup-splash'
import Timer from 'timer'
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

function installPlatformInputBridge(): void {
  if (!Modules.has('wasm-button-bridge')) return
  const bridge = Modules.importNow('wasm-button-bridge') as { installWasmButtons?: () => void }
  bridge.installWasmButtons?.()
  trace('[main] installed WASM button bridge\n')
}

function restartForModMaintenance(): void {
  try {
    restartInModMaintenance()
  } catch (error) {
    reportStartupFailure(error)
  }
}

function reportStartupFailure(error: unknown): void {
  trace(`[main] error ${error instanceof Error ? error.message : String(error)}\n`)
  try {
    initializeLocalization(getHostSettingsService().get('ui.language'))
  } catch {
    initializeLocalization('en')
  }
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'STARTUP_FAILED'
  showStartupFailure({
    message: localize('boot.appFailed'),
    detail: `${code}\n${localize('boot.replaceMod')}`,
    onMods: Modules.has('mod-manager') ? restartForModMaintenance : undefined,
    onRestart: globalEnv.System?.restart ? () => globalEnv.System.restart() : undefined,
  })
}

function installModManagerShortcut(): void {
  const powerButton = globalEnv.button?.power
  if (!powerButton || !Modules.has('mod-manager')) return
  installLaunchShortcut(powerButton, restartForModMaintenance)
}

async function main() {
  trace('[main] start\n')
  const bootResources = new ResourceScope()
  let dockRuntime: StackchanDockRuntime | undefined
  let context: StackchanRuntimeContext | undefined
  try {
    // SD writing runs only in a fresh VM which has never evaluated MOD code.
    // V1 MODs can own raw timers; closing the V2 context alone cannot stop them.
    if (Modules.has('mod-manager') && isModMaintenanceActive()) {
      initializeLocalization(getHostSettingsService().get('ui.language'))
      const startModManager = Modules.importNow('mod-manager') as (
        application: ReturnType<typeof showStartupSplash>,
      ) => Promise<'back'>
      await startModManager(showStartupSplash())
      globalEnv.System.restart()
      return
    }
    installPlatformInputBridge()
    const hostSettings = getHostSettingsService()
    initializeLocalization(hostSettings.get('ui.language'))
    applyTimezone(hostSettings.get('time.timezone'))
    if (
      !(await runHostStartup({
        timer: Timer,
        showSplash: showStartupSplash,
        openSettings: startSetupMode,
        openMods: Modules.has('mod-manager') ? restartInModMaintenance : undefined,
        autoBootDelayMs: config.wasm ? 8000 : undefined,
      }))
    ) {
      installModManagerShortcut()
      await bootResources.close()
      return
    }

    const modContract = verifyInstalledMod()
    // Reserve Dock buffers before MOD evaluation, Wi-Fi, and the runtime context.
    dockRuntime = startStackchanDock(Modules, loadModConfig())
    if (dockRuntime) bootResources.own(dockRuntime)
    const program = resolveAppProgram(Modules, defaultApp, modContract?.appApiVersion)
    if (program.generation === 1 && (await program.behavior.onLaunch?.()) === false) {
      installModManagerShortcut()
      await bootResources.close()
      return
    }
    const preferences = loadPreferenceConfig()
    initializeLocalization(preferences.ui.language)
    applyTimezone(preferences.time.timezone)
    const bootServices = startHostBootServices({
      credentials: { ssid: preferences.wifi.ssid ?? '', password: preferences.wifi.password ?? '' },
      wifi:
        program.generation === 1
          ? {
              onStatusChanged: showWiFiConnectionStatus,
              promptRecoveryChoice: (status, signal) =>
                requestBootRecoveryChoice(status.message, signal, showWiFiRecoveryChoice, globalEnv.button ?? {}),
            }
          : undefined,
    })
    bootResources.own(bootServices)
    if (program.generation === 1) {
      const networkReady = await bootServices.connectivity.network.ready
      bootServices.signal.throwIfCancelled()
      trace(`[main] network ready: ${networkReady.status}\n`)
    } else {
      void bootServices.connectivity.network.ready.then((result) => {
        if (!bootServices.closed) trace(`[network] ${result.status}\n`)
      })
    }
    const ownedDock = dockRuntime
    context = await createStackchanContext(preferences, {
      connectivity: bootServices.connectivity,
      remoteConversationSession: ownedDock?.remoteConversationSession,
      closeHandlers: [() => bootResources.close()],
    })
    ownedDock?.onContextCreated(context)
    trace('[main] app context created\n')
    if (program.generation === 2) await context.startApp(program.app)
    else
      await program.behavior.onContextCreated?.(context, {
        device: getHostDeviceEnvironment(),
        config: preferences,
      })
    trace('[main] app behaviors ready\n')
    installModManagerShortcut()
  } catch (error) {
    try {
      if (context) await context.lifecycle.close()
      else await bootResources.close()
    } catch (closeError) {
      trace(`[main] cleanup error ${closeError instanceof Error ? closeError.message : String(closeError)}\n`)
    }
    installModManagerShortcut()
    throw error
  }
}

export default function start(failure?: unknown): Promise<void> {
  if (failure !== undefined) {
    reportStartupFailure(failure)
    return Promise.resolve()
  }
  return main().catch(reportStartupFailure)
}
