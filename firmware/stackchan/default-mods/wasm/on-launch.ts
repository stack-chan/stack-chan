import type { StackchanMod } from 'default-mods/mod'
import { showStartupSplash } from 'startup-splash'
import Timer from 'timer'

const SPLASH_VISIBLE_MS = 8000

export const onLaunch: StackchanMod['onLaunch'] = () => {
  showStartupSplash()
  return new Promise<boolean>((resolve) => {
    Timer.set(() => {
      resolve(true)
    }, SPLASH_VISIBLE_MS)
  })
}
