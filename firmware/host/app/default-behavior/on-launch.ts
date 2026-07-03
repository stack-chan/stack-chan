import type { StackchanAppBehavior } from 'app-behavior'
import { waitForStartupChoice } from 'app-default-behavior/startup-choice'
import { startSetupMode } from 'setup-mode'
import { showStartupSplash } from 'startup-splash'
import Timer from 'timer'

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
