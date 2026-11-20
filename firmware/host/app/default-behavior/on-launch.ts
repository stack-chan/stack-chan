import type { StackchanAppBehavior } from 'app-behavior'
import { waitForStartupChoice } from 'app-default-behavior/startup-choice'
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
      const startModManager = Modules.importNow('mod-manager') as (
        application: ReturnType<typeof showStartupSplash>,
      ) => Promise<'back'>
      await startModManager(startupChoice.application)
      continue
    }
    const setupChoice = await startSetupMode(startupChoice.application)
    if (setupChoice === 'boot') return true
  }
}
