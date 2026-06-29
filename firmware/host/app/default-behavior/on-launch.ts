import type { StackchanAppBehavior } from 'app-behavior'
import { DOMAIN, PREF_KEYS } from 'consts'
import { startNetworkConnection, stopNetworkConnection } from 'network-manager'
import type { Application as PiuApplication } from 'piu/MC'
import Preference from 'preference'
import { PreferenceServer } from 'preference-server'
import { buildSettingsView, type SettingsStatus, updateSettingsStatusLabels } from 'settings-view'
import { showStartupSplash } from 'startup-splash'
import Timer from 'timer'

type StartupChoice = 'boot' | 'settings'

const STARTUP_AUTO_BOOT_DELAY_MS = 3000

type StartupChoiceResult = {
  choice: StartupChoice
  application: PiuApplication
}

function waitForStartupChoice(): Promise<StartupChoiceResult> {
  return new Promise((resolve) => {
    let isResolved = false
    const choose = (choice: StartupChoice, application: PiuApplication) => {
      if (isResolved) return
      isResolved = true
      Timer.clear(handle)
      resolve({ choice, application })
    }

    const application = showStartupSplash({ onTouch: () => Timer.set(() => choose('settings', application), 0) })
    const handle = Timer.set(() => choose('boot', application), STARTUP_AUTO_BOOT_DELAY_MS)
  })
}

const preferenceString = (key: string): string => {
  const value = Preference.get(DOMAIN.wifi, key)
  return value === undefined || value === null ? '' : String(value)
}

function connectStoredWiFi(
  status?: SettingsStatus,
  labels?: ReturnType<typeof buildSettingsView>,
  onConnected?: () => void,
  onError?: () => void,
): void {
  const ssid = status?.['wifi.ssid'] ?? preferenceString('ssid')
  const password = status?.['wifi.password'] ?? preferenceString('password')
  if (ssid.length === 0 || password.length === 0) return
  startNetworkConnection({
    ssid,
    password,
    onStateChanged: (state) => {
      if (!status || !labels) return
      status.wifi = state
      updateSettingsStatusLabels(labels, status)
    },
    onConnected,
    onError,
  })
}

export const onLaunch: NonNullable<StackchanAppBehavior['onLaunch']> = async () => {
  const startupChoice = await waitForStartupChoice()
  if (startupChoice.choice === 'boot') {
    connectStoredWiFi()
    return true
  }
  const status: SettingsStatus = {
    ble: 'not connected',
    wifi: 'not connected',
    'wifi.ssid': preferenceString('ssid'),
    'wifi.password': preferenceString('password'),
  }
  const testConnection = () => {
    if (status['wifi.ssid'].length === 0 || status['wifi.password'].length === 0) {
      return
    }
    stopNetworkConnection()
    connectStoredWiFi(
      status,
      labels,
      () => {
        trace('connection complete\n')
        status.wifi = 'connected'
        updateSettingsStatusLabels(labels, status)
      },
      () => {
        trace('connection failed\n')
        status.wifi = 'failed'
        updateSettingsStatusLabels(labels, status)
      },
    )
  }
  const labels = buildSettingsView(startupChoice.application, status, { onConnect: testConnection })

  new PreferenceServer({
    onPreferenceChanged: (key, value) => {
      trace(`preference changed! ${key}: ${value}\n`)
      status[key] = value
      updateSettingsStatusLabels(labels, status)
    },
    onConnected: () => {
      status.ble = 'connected'
      updateSettingsStatusLabels(labels, status)
    },
    onDisconnected: () => {
      status.ble = 'not connected'
      updateSettingsStatusLabels(labels, status)
    },
    keys: PREF_KEYS,
  })

  return false
}
