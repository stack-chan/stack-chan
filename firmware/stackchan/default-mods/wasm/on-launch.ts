import Timer from 'timer'
import Preference from 'preference'
import { DOMAIN } from 'consts'
import { showStartupSplash } from 'startup-splash'
import { showSetupUI } from 'setup-ui'
import type { StackchanMod } from 'default-mods/mod'

const WASM_SETUP_PREVIEW_DELAY_MS = 500

const preferenceString = (key: string): string => {
  const value = Preference.get(DOMAIN.wifi, key)
  return value === undefined || value === null ? '' : String(value)
}

export const onLaunch: StackchanMod['onLaunch'] = () => {
  const application = showStartupSplash()
  return new Promise<boolean>((resolve) => {
    Timer.set(() => {
      showSetupUI({
        application,
        initialDraft: {
          ssid: preferenceString('ssid'),
          password: preferenceString('password'),
        },
      })
      resolve(false)
    }, WASM_SETUP_PREVIEW_DELAY_MS)
  })
}
