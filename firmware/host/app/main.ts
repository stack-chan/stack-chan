import defaultBehavior from 'app-default-behavior'
import Modules from 'modules'
import { asyncWait } from 'stackchan-util'
import { runContextCreatedBehaviors, runLaunchBehaviors, type StackchanAppBehavior } from './app-behavior'
import {
  connectConfiguredWiFi,
  createStackchanContext,
  getHostDeviceEnvironment,
  installSimulatorButtons,
} from './compose'

function resolveAppBehaviors(): StackchanAppBehavior[] {
  const behaviors: StackchanAppBehavior[] = [defaultBehavior]
  trace('[main] checking mod override\n')
  if (Modules.has('mod')) {
    const behavior = Modules.importNow('mod') as StackchanAppBehavior
    behaviors.push(behavior)
  }
  return behaviors
}

async function main() {
  trace('[main] start\n')
  installSimulatorButtons()

  await asyncWait(100)
  trace('[main] check Wi-Fi start\n')
  await connectConfiguredWiFi().catch((msg) => {
    trace(`WiFi connection failed: ${msg}\n`)
  })
  trace('[main] check Wi-Fi complete\n')

  trace('[main] loading app behaviors\n')
  const appBehaviors = resolveAppBehaviors()
  const shouldCreateContext = await runLaunchBehaviors(appBehaviors)
  trace(`[main] onLaunch shouldCreateContext=${shouldCreateContext}\n`)
  if (!shouldCreateContext) return

  const context = createStackchanContext()
  trace('[main] app context created\n')
  await runContextCreatedBehaviors(appBehaviors, context, getHostDeviceEnvironment())
  trace('[main] app behaviors ready\n')
}

main().catch((error) => {
  trace(`[main] error ${error?.message ?? error}\n`)
})
