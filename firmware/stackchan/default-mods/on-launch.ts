import { NetworkService } from 'network-service'
import { showStartupSplash } from 'startup-splash'
import { showSetupUI } from 'setup-ui'
import { PreferenceServer } from 'preference-server'
import Preference from 'preference'
import type { StackchanMod } from 'default-mods/mod'
import type { Application as PiuApplication } from 'piu/MC'
import { DOMAIN, PREF_KEYS } from 'consts'
import Timer from 'timer'

type StartupChoice = 'boot' | 'settings'

const STARTUP_AUTO_BOOT_DELAY_MS = 3000

type Status = {
  ble: string
  wifi: string
  'wifi.ssid'?: string
  'wifi.password'?: string
}

type StartupChoiceResult = {
  choice: StartupChoice
  application: PiuApplication
}

function waitForStartupChoice(): Promise<StartupChoiceResult> {
  return new Promise((resolve) => {
    let isResolved = false
    let handle: ReturnType<typeof Timer.set> | undefined
    let application: PiuApplication
    const choose = (choice: StartupChoice) => {
      if (isResolved) return
      isResolved = true
      if (handle) Timer.clear(handle)
      resolve({ choice, application })
    }

    application = showStartupSplash({ onTouch: () => Timer.set(() => choose('settings'), 0) })
    handle = Timer.set(() => choose('boot'), STARTUP_AUTO_BOOT_DELAY_MS)
  })
}

const preferenceString = (key: string): string => {
  const value = Preference.get(DOMAIN.wifi, key)
  return value === undefined || value === null ? '' : String(value)
}

export const onLaunch: StackchanMod['onLaunch'] = async () => {
  const startupChoice = await waitForStartupChoice()
  if (startupChoice.choice === 'boot') {
    return true
  }
  const status: Status = {
    ble: 'not connected',
    wifi: 'not connected',
    'wifi.ssid': preferenceString('ssid'),
    'wifi.password': preferenceString('password'),
  }
  showSetupUI({
    application: startupChoice.application,
    initialDraft: {
      ssid: status['wifi.ssid'],
      password: status['wifi.password'],
    },
    onDraftChanged: (draft) => {
      status['wifi.ssid'] = draft.ssid ?? ''
      status['wifi.password'] = draft.password ?? ''
    },
  })

  new PreferenceServer({
    onPreferenceChanged: (key, value) => {
      trace(`preference changed! ${key}: ${value}\n`)
      status[key] = value
    },
    onConnected: () => {
      status.ble = 'connected'
    },
    onDisconnected: () => {
      status.ble = 'not connected'
    },
    keys: PREF_KEYS,
  })

  let networkService: NetworkService
  if (globalThis.button) {
    globalThis.button.a.onChanged = () => {
      if (status['wifi.ssid'].length > 0) {
        if (networkService != null) {
          networkService.close()
          networkService = null
        }
        networkService = new NetworkService({
          ssid: status['wifi.ssid'],
          password: status['wifi.password'],
        })
        networkService.connect(
          () => {
            trace('connection complete\n')
            status.wifi = 'connected'
          },
          () => {
            trace('connection failed\n')
            status.wifi = 'failed'
          },
        )
        status.wifi = 'connecting'
      }
    }
  }
  return false
}
