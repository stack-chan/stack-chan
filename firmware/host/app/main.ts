import defaultMod, { type StackchanMod } from 'default-mods/mod'
import Modules from 'modules'
import { asyncWait } from 'stackchan-util'
import {
  connectConfiguredWiFi,
  createStackchanContext,
  getHostDeviceEnvironment,
  installSimulatorButtons,
} from './compose'

function resolveMod(): StackchanMod {
  let { onRobotCreated, onLaunch } = defaultMod
  trace('[main] checking mod override\n')
  if (Modules.has('mod')) {
    const mod = Modules.importNow('mod') as StackchanMod
    onRobotCreated = mod.onRobotCreated ?? onRobotCreated
    onLaunch = mod.onLaunch ?? onLaunch
  }
  return { onRobotCreated, onLaunch }
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

  trace('[main] loading default mod\n')
  const { onRobotCreated, onLaunch } = resolveMod()
  const shouldRobotCreate = await (onLaunch?.() ?? true)
  trace(`[main] onLaunch shouldRobotCreate=${shouldRobotCreate}\n`)
  if (!shouldRobotCreate) return

  const context = createStackchanContext()
  trace('[main] app context created\n')
  await onRobotCreated?.(context, getHostDeviceEnvironment())
  trace('[main] onRobotCreated complete\n')
}

main().catch((error) => {
  trace(`[main] error ${error?.message ?? error}\n`)
})
