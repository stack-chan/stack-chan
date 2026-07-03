import { loadPreferenceConfig } from 'loadPreference'
import { runContextCreatedBehaviors, runLaunchBehaviors, type StackchanAppBehavior } from 'app-behavior'
import { resolveAppBehaviors } from 'app-behavior-resolver'
import defaultBehavior from 'app-default-behavior'
import { startHostBootServices } from 'boot-services'
import { createStackchanContext, getHostDeviceEnvironment, installSimulatorButtons } from 'compose'
import Modules from 'modules'

function loadAppBehaviors(): StackchanAppBehavior[] {
  trace('[main] checking mod override\n')
  return resolveAppBehaviors(Modules, defaultBehavior)
}

async function main() {
  trace('[main] start\n')
  installSimulatorButtons()
  const bootServices = startHostBootServices()

  trace('[main] loading app behaviors\n')
  const appBehaviors = loadAppBehaviors()
  const shouldCreateContext = await runLaunchBehaviors(appBehaviors)
  trace(`[main] onLaunch shouldCreateContext=${shouldCreateContext}\n`)
  if (!shouldCreateContext) return

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
