import verifyInstalledMod from 'installed-mod'
import detachModArchive from 'mod-archive-control'
import { takeModMaintenanceRequest } from 'mod-maintenance'
import Modules from 'modules'

// This entry imports no app, UI, network, or MOD configuration. In maintenance
// and recovery, even resource lookup must stop consulting the writable archive.
function boot(): Promise<void> {
  let failure: unknown
  try {
    if (takeModMaintenanceRequest()) detachModArchive()
    else verifyInstalledMod()
  } catch (error) {
    detachModArchive()
    failure = error
  }
  const start = Modules.importNow('app-main') as (failure?: unknown) => Promise<void>
  return start(failure)
}

Promise.resolve()
  .then(boot)
  .catch((error) => trace(`[main] bootstrap error ${error?.message ?? error}\n`))
