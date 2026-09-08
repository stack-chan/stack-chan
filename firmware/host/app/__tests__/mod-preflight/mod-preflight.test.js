import { getHostSettingsService } from 'loadPreference'
import Resource from 'Resource'
import verifyInstalledMod, { inspectInstalledMod } from 'installed-mod'
import detachModArchive from 'mod-archive-control'
import { requestModMaintenance, takeModMaintenanceRequest } from 'mod-maintenance'
import Modules from 'modules'
import { assertModCompatibility } from 'stackchan-contracts/mod-package'
import { inspectModArchive } from 'stackchan-contracts/xsa-metadata'
import { equal } from 'testing/assert'
import TextDecoder from 'text/decoder'
import TextEncoder from 'text/encoder'
import { makeXsArchive, modDefinition } from 'xsa-fixture'

function run() {
  globalThis.TextEncoder = TextEncoder
  const decode = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const { metadata } = inspectModArchive(makeXsArchive(), decode)
  equal(metadata.appApiVersion, 2, 'XS reads the same application generation as Node')
  let rejected = false
  try {
    assertModCompatibility(metadata, { hostApiVersion: 1 })
  } catch (error) {
    rejected = error.code === 'MOD_HOST_API_UNSUPPORTED'
  }
  equal(rejected, true, 'XS rejects older hosts')

  const encoded = (value) => new TextEncoder().encode(JSON.stringify(value)).buffer
  function rejects(action, code) {
    let error
    try {
      action()
    } catch (caught) {
      error = caught
    }
    equal(error?.code, code, `rejects ${code}`)
  }

  equal(verifyInstalledMod(), undefined, 'no archive during preload')
  rejects(
    () => inspectInstalledMod(['mod'], () => new Resource('stackchan-mod.json').slice(0)),
    'MOD_HOST_API_UNSUPPORTED',
  )
  rejects(() => inspectInstalledMod(['mod', 'mod/config'], () => encoded(modDefinition)), 'MOD_APP_API_UNSUPPORTED')
  rejects(
    () => inspectInstalledMod(['mod'], () => encoded({ ...modDefinition, appApiVersion: 1 })),
    'MOD_APP_API_UNSUPPORTED',
  )
  for (const [target, declaration, code] of [
    ['stackchan-rt', { ...modDefinition, targets: ['m5stackchan-cores3'] }, 'MOD_TARGET_UNSUPPORTED'],
    [null, { ...modDefinition, targets: ['m5stackchan-cores3'] }, 'MOD_TARGET_UNKNOWN'],
    ['simulator', { ...modDefinition, hostApiVersion: 7, capabilities: ['audio.radio'] }, 'MOD_CAPABILITY_UNAVAILABLE'],
  ])
    rejects(() => inspectInstalledMod(['mod'], () => encoded(declaration), target), code)
  equal(
    inspectInstalledMod(['mod'], () => encoded({ ...modDefinition, targets: ['simulator'] }), 'simulator')
      .appApiVersion,
    2,
    'matching board is accepted',
  )
  getHostSettingsService().get('ui.language')
  equal(inspectInstalledMod(['mod'], () => encoded(modDefinition)).appApiVersion, 2, 'supported app declared')
  rejects(() => inspectInstalledMod(['mod'], () => undefined), 'MOD_METADATA_MISSING')
  rejects(() => inspectInstalledMod(['mod'], () => new Uint8Array([0xff]).buffer), 'MOD_METADATA_INVALID')
  rejects(() => inspectInstalledMod(['mod'], () => new ArrayBuffer(16_385)), 'MOD_METADATA_INVALID')
  rejects(() => inspectInstalledMod(['miniapp'], () => encoded(modDefinition)), 'MOD_ENTRYPOINT_MISMATCH')
  equal(takeModMaintenanceRequest(), false, 'normal boot does not select maintenance')
  requestModMaintenance()
  equal(takeModMaintenanceRequest(), true, 'next boot consumes maintenance request')
  equal(takeModMaintenanceRequest(), false, 'maintenance request is consumed once')
  detachModArchive()
  detachModArchive()
  equal(Modules.archive.length, 0, 'detaching an empty archive is idempotent')
  equal(Modules.has('installed-mod'), true, 'host modules remain available after detachment')
  equal(Resource.exists('stackchan-mod.json'), true, 'host resources remain available after detachment')
  trace('ok\n')
}
Promise.resolve()
  .then(run)
  .catch((error) => trace(`FAIL ${error.message}: ${error.stack}\n`))
