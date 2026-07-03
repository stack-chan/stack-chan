import type { StackchanAppBehavior } from 'app-behavior'
import { waitForStartupChoice } from 'app-default-behavior/startup-choice'
import { showStartupSplash } from 'startup-splash'
import Timer from 'timer'
import { startSetupMode } from '../setup-mode'

export const onLaunch: NonNullable<StackchanAppBehavior['onLaunch']> = async () => {
  const startupChoice = await waitForStartupChoice<ReturnType<typeof showStartupSplash>>({
    timer: Timer,
    showStartupSplash,
  })
  if (startupChoice.choice === 'boot') {
    return true
  }
  startSetupMode(startupChoice.application)
  return false
}
