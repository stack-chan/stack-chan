import { loadPreferenceConfig } from 'loadPreference'
import { runContextCreatedBehaviors, runLaunchBehaviors, type StackchanAppBehavior } from 'app-behavior'
import { resolveAppBehaviors } from 'app-behavior-resolver'
import defaultBehavior from 'app-default-behavior'
import { type BootWiFiStatus, startHostBootServices } from 'boot-services'
import { createStackchanContext, getHostDeviceEnvironment, installSimulatorButtons } from 'compose'
import Modules from 'modules'
import { showWiFiConnectionStatus, showWiFiRecoveryChoice } from 'startup-splash'

type DeviceButton = {
  onChanged: (this: DeviceButton) => void
}

type GlobalEnvironment = {
  button?: Partial<Record<'a' | 'c', DeviceButton>>
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment
const noopButtonHandler = () => undefined

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
  installSimulatorButtons()

  trace('[main] loading app behaviors\n')
  const appBehaviors = loadAppBehaviors()
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
