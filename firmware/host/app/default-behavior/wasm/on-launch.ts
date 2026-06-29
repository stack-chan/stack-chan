import type { StackchanAppBehavior } from 'app-behavior'
import { showStartupSplash } from 'startup-splash'
import Timer from 'timer'

const SPLASH_VISIBLE_MS = 8000

export const onLaunch: NonNullable<StackchanAppBehavior['onLaunch']> = () => {
  showStartupSplash()
  return new Promise<boolean>((resolve) => {
    Timer.set(() => {
      resolve(true)
    }, SPLASH_VISIBLE_MS)
  })
}
