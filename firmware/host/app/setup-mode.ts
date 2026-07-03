import { PREF_KEYS } from 'consts'
import { NetworkConnectionState, type NetworkConnectionState as NetworkState } from 'network-state'
import { PreferenceServer } from 'preference-server'
import { buildSettingsView, type SettingsStatus, SettingsStatusValue, updateSettingsStatusLabels } from 'settings-view'
import { connectStoredWiFi, readStoredWiFiPreference, stopStoredWiFiConnection } from 'stored-wifi'

type SetupApplication = Parameters<typeof buildSettingsView>[0]

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

export function startSetupMode(application: SetupApplication): void {
  const status: SettingsStatus = {
    ble: SettingsStatusValue.NOT_CONNECTED,
    wifi: SettingsStatusValue.NOT_CONNECTED,
    'wifi.ssid': readStoredWiFiPreference('ssid'),
    'wifi.password': readStoredWiFiPreference('password'),
  }
  const testConnection = () => {
    if (status['wifi.ssid'].length === 0 || status['wifi.password'].length === 0) {
      return
    }
    stopStoredWiFiConnection()
    connectStoredWiFi({
      ssid: status['wifi.ssid'],
      password: status['wifi.password'],
      onStateChanged: (state: NetworkState) => {
        status.wifi = settingsWifiStatusFromNetworkState(state)
        updateSettingsStatusLabels(labels, status)
      },
      onConnected: () => {
        trace('connection complete\n')
        status.wifi = SettingsStatusValue.CONNECTED
        updateSettingsStatusLabels(labels, status)
      },
      onError: () => {
        trace('connection failed\n')
        status.wifi = SettingsStatusValue.FAILED
        updateSettingsStatusLabels(labels, status)
      },
    })
  }
  const labels = buildSettingsView(application, status, { onConnect: testConnection })

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
}
