import type { LaunchShortcutButton } from 'app-launch'
import Modules from 'modules'
import { state } from 'startup-error-ports'
import { equal } from 'testing/assert'
import Timer from 'timer'

const power: LaunchShortcutButton = { read: () => 0 }
const environment = globalThis as typeof globalThis & { button?: { power: LaunchShortcutButton } }
environment.button = { power }

let finishShutdown: (() => void) | undefined
state.close = () =>
  new Promise<void>((resolve) => {
    finishShutdown = resolve
  })

async function waitUntil(check: () => boolean): Promise<void> {
  for (let checkCount = 0; checkCount < 100 && !check(); checkCount++) {
    await new Promise<void>((resolve) => Timer.set(() => resolve(), 10))
  }
}

function managerOpened(): boolean {
  return state.closeEvents.includes('mod-manager')
}

async function run(): Promise<void> {
  Modules.importNow('host-main')
  await waitUntil(() => power.onChanged !== undefined)
  equal(typeof power.onChanged, 'function', 'Host startup must install the power button shortcut')
  power.onChanged?.call(power)

  await waitUntil(() => finishShutdown !== undefined || managerOpened())
  equal(typeof finishShutdown, 'function', 'the shortcut must close the active context')
  equal(managerOpened(), false, 'the MOD Manager must wait for context shutdown')

  finishShutdown?.()
  await waitUntil(managerOpened)
  equal(managerOpened(), true, 'the MOD Manager must open after cleanup')
  trace('@@STACKCHAN_TEST:PASS@@\n')
}

run().catch((error) => {
  trace(`@@STACKCHAN_TEST:FAIL@@ ${String(error)}\n`)
  throw error
})
