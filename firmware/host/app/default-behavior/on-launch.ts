import type { StackchanAppBehavior } from 'app-behavior'
import { waitForStartupChoice } from 'app-default-behavior/startup-choice'
import { DOMAIN, PREF_KEYS } from 'consts'
import { startNetworkConnection, stopNetworkConnection } from 'network-manager'
import { NetworkConnectionState, type NetworkConnectionState as NetworkState } from 'network-state'
import Preference from 'preference'
import { PreferenceServer } from 'preference-server'
import { buildSettingsView, type SettingsStatus, SettingsStatusValue, updateSettingsStatusLabels } from 'settings-view'
import { showStartupSplash } from 'startup-splash'
import Timer from 'timer'

const preferenceString = (key: string): string => {
  const value = Preference.get(DOMAIN.wifi, key)
  return value === undefined || value === null ? '' : String(value)
}

function settingsWifiStatusFromNetworkState(state: NetworkState): SettingsStatusValue {
  switch (state) {
    case NetworkConnectionState.SCANNING:
      return SettingsStatusValue.SCANNING
    case NetworkConnectionState.CONNECTING:
      return SettingsStatusValue.CONNECTING
    case NetworkConnectionState.SYNCING_TIME:
      return SettingsStatusValue.SYNCING_TIME
    case NetworkConnectionState.CONNECTED:
      return SettingsStatusValue.CONNECTED
    case NetworkConnectionState.RECONNECTING:
      return SettingsStatusValue.RECONNECTING
    case NetworkConnectionState.FAILED:
      return SettingsStatusValue.FAILED
    case NetworkConnectionState.CLOSED:
    case NetworkConnectionState.IDLE:
      return SettingsStatusValue.NOT_CONNECTED
  }
  return SettingsStatusValue.NOT_CONNECTED
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
      status.wifi = settingsWifiStatusFromNetworkState(state)
      updateSettingsStatusLabels(labels, status)
    },
    onConnected,
    onError,
  })
}

export const onLaunch: NonNullable<StackchanAppBehavior['onLaunch']> = async () => {
  const startupChoice = await waitForStartupChoice<ReturnType<typeof showStartupSplash>>({
    timer: Timer,
    showStartupSplash,
  })
  if (startupChoice.choice === 'boot') {
    connectStoredWiFi()
    return true
  }
  const status: SettingsStatus = {
    ble: SettingsStatusValue.NOT_CONNECTED,
    wifi: SettingsStatusValue.NOT_CONNECTED,
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
        status.wifi = SettingsStatusValue.CONNECTED
        updateSettingsStatusLabels(labels, status)
      },
      () => {
        trace('connection failed\n')
        status.wifi = SettingsStatusValue.FAILED
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
      status.ble = SettingsStatusValue.CONNECTED
      updateSettingsStatusLabels(labels, status)
    },
    onDisconnected: () => {
      status.ble = SettingsStatusValue.NOT_CONNECTED
      updateSettingsStatusLabels(labels, status)
    },
    keys: PREF_KEYS,
  })

  return false
}
