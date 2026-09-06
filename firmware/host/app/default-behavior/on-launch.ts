import type { StackchanAppBehavior } from 'app-behavior'
import { waitForStartupChoice } from 'app-default-behavior/startup-choice'
import { restartInModMaintenance } from 'mod-maintenance'
import Modules from 'modules'
import { startSetupMode } from 'setup-mode'
import { showStartupSplash } from 'startup-splash'
import Timer from 'timer'

export const onLaunch: NonNullable<StackchanAppBehavior['onLaunch']> = async () => {
  while (true) {
    const startupChoice = await waitForStartupChoice<ReturnType<typeof showStartupSplash>>({
      timer: Timer,
      showStartupSplash,
      enableMods: Modules.has('mod-manager'),
    })
    if (startupChoice.choice === 'boot') return true
    if (startupChoice.choice === 'mods') {
      restartInModMaintenance()
      return false
    }
    const setupChoice = await startSetupMode(startupChoice.application)
    if (setupChoice === 'boot') return true
  }
}
