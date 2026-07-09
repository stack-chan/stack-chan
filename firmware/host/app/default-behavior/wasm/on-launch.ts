import { waitForStartupChoice } from 'app-default-behavior/startup-choice'
import { startSetupMode } from 'setup-mode'
import { showStartupSplash } from 'startup-splash'
import Timer from 'timer'

const SPLASH_VISIBLE_MS = 8000

export const onLaunch = async (): Promise<boolean> => {
  const startupChoice = await waitForStartupChoice<ReturnType<typeof showStartupSplash>>({
    timer: Timer,
    showStartupSplash,
    autoBootDelayMs: SPLASH_VISIBLE_MS,
  })
  if (startupChoice.choice === 'boot') {
    return true
  }
  startSetupMode(startupChoice.application)
  return false
}
