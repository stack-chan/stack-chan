import { getHostSettingsService, loadPreferenceConfig } from 'loadPreference'
import { resolveAppDefinition } from 'app-definition'
import { installLaunchShortcut, type LaunchShortcutButton } from 'app-launch'
import { startHostBootServices } from 'boot-services'
import { createStackchanContext } from 'compose'
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
import { CAPABILITY_IDS } from 'stackchan-contracts/capabilities'
import {
  assertModCompatibility,
  ModCompatibilityError,
  STACKCHAN_HOST_API_VERSION,
} from 'stackchan-contracts/mod-package'
import { showStartupFailure, showStartupSplash } from 'startup-splash'
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
  const missing = error instanceof ModCompatibilityError ? error.capabilities : []
  const recovery =
    code === 'MOD_TARGET_UNKNOWN' || code === 'MOD_HOST_API_UNSUPPORTED'
      ? 'boot.updateFirmware'
      : code === 'MOD_TARGET_UNSUPPORTED'
        ? 'boot.targetUnsupported'
        : 'boot.replaceMod'
  showStartupFailure({
    message: localize('boot.appFailed'),
    detail: missing.length
      ? `${localize('boot.capabilityUnavailable')}\n${missing.slice(0, 2).join(', ')}${missing.length > 2 ? ` +${missing.length - 2}` : ''}`
      : `${code}\n${localize(recovery)}`,
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
    // Rewriting the archive must not invalidate code executing in this VM.
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

    const contract = verifyInstalledMod()
    // Reserve Dock buffers before MOD evaluation, Wi-Fi, and the runtime context.
    dockRuntime = startStackchanDock(Modules, contract?.capabilities)
    if (dockRuntime) bootResources.own(dockRuntime)
    const preferences = loadPreferenceConfig()
    initializeLocalization(preferences.ui.language)
    applyTimezone(preferences.time.timezone)
    const bootServices = startHostBootServices({
      credentials: { ssid: preferences.wifi.ssid ?? '', password: preferences.wifi.password ?? '' },
    })
    bootResources.own(bootServices)
    void bootServices.connectivity.network.ready.then((result) => {
      if (!bootServices.closed) trace(`[network] ${result.status}\n`)
    })
    const ownedDock = dockRuntime
    context = await createStackchanContext(preferences, {
      connectivity: bootServices.connectivity,
      remoteConversationSession: ownedDock?.remoteConversationSession,
      closeHandlers: [() => bootResources.close()],
    })
    const readyContext = context
    if (contract)
      assertModCompatibility(contract, {
        hostApiVersion: STACKCHAN_HOST_API_VERSION,
        capabilities: CAPABILITY_IDS.filter((id) => readyContext.getCapability(id).availability !== 'unavailable'),
      })
    const app = resolveAppDefinition(Modules, defaultApp)
    ownedDock?.attach(context.presentation)
    trace('[main] app context created\n')
    await context.startApp(app)
    trace('[main] app ready\n')
    installModManagerShortcut()
  } catch (error) {
    try {
      if (context) await context.close()
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
