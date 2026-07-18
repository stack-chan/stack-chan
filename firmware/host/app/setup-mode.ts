import { loadPreferenceConfig } from 'loadPreference'
import { DOMAIN, PREF_KEYS } from 'consts'
import { getLocalizationLanguage, normalizeLocale, type SupportedLocale, setLocalizationLanguage } from 'localization'
import { NetworkConnectionState, type NetworkConnectionState as NetworkState } from 'network-state'
import Preference from 'preference'
import { PreferenceServer } from 'preference-server'
import { createSettingsNetworkEntries, type RawWiFiScanResult, type SettingsNetworkEntry } from 'settings-network-list'
import { createInitialSettingsStatus } from 'settings-status'
import {
  buildSettingsLanguageView,
  buildSettingsPasswordView,
  buildSettingsView,
  type SettingsStatusLabels,
  SettingsStatusValue,
  updateSettingsNetworkLabels,
  updateSettingsStatusLabels,
} from 'settings-view'
import { connectStoredWiFi, stopStoredWiFiConnection } from 'stored-wifi'
import { scanWiFiNetworks } from 'wifi-scan'
import type { WiFiScanSession } from 'wifi-scan-types'

type SetupApplication = Parameters<typeof buildSettingsView>[0]
export type SetupModeResult = 'back' | 'boot'
type SetupView = 'settings' | 'password' | 'language'

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

export function startSetupMode(application: SetupApplication): Promise<SetupModeResult> {
  return new Promise((resolve) => {
    const status = createInitialSettingsStatus(loadPreferenceConfig())
    let labels: SettingsStatusLabels
    let scanSession: WiFiScanSession | undefined
    let scanResults: RawWiFiScanResult[] = []
    let preferenceServer: PreferenceServer | undefined
    let finished = false
    let currentView: SetupView = 'settings'
    let currentPasswordSSID = ''

    const finish = (result: SetupModeResult) => {
      if (finished) return
      finished = true
      scanSession?.close()
      scanSession = undefined
      preferenceServer?.close?.()
      if (result === 'back') stopStoredWiFiConnection()
      resolve(result)
    }

    const showSettingsView = () => {
      currentView = 'settings'
      labels = buildSettingsView(application, status, {
        onBack: () => finish('back'),
        onBoot: () => finish('boot'),
        onLanguage: showLanguageView,
        onScan: scanNetworks,
        onSelectNetwork: selectNetwork,
      })
      updateNetworkList()
    }

    const showLanguageView = () => {
      scanSession?.close()
      scanSession = undefined
      if (status.wifi === SettingsStatusValue.SCANNING) status.wifi = SettingsStatusValue.NOT_CONNECTED
      currentView = 'language'
      buildSettingsLanguageView(application, {
        current: getLocalizationLanguage(),
        onBack: showSettingsView,
        onSelect: (locale: SupportedLocale) => applyLanguage(locale, true),
      })
    }

    const updateNetworkList = () => {
      if (currentView !== 'settings') return
      updateSettingsNetworkLabels(labels, createSettingsNetworkEntries(scanResults))
    }

    const updateStatusLabels = () => {
      if (currentView !== 'settings') return
      updateSettingsStatusLabels(labels, status)
    }

    const showPasswordView = (ssid: string) => {
      currentView = 'password'
      currentPasswordSSID = ssid
      buildSettingsPasswordView(application, ssid, {
        onBack: showSettingsView,
        onPassword: (password) => {
          status['wifi.password'] = password
          Preference.set(DOMAIN.wifi, 'password', password)
          showSettingsView()
          testConnection()
        },
      })
    }

    const applyLanguage = (value: unknown, persist: boolean) => {
      const locale = setLocalizationLanguage(value)
      status['ui.language'] = locale
      if (persist || normalizeLocale(value) !== locale) Preference.set(DOMAIN.ui, 'language', locale)
      switch (currentView) {
        case 'settings':
          showSettingsView()
          break
        case 'password':
          showPasswordView(currentPasswordSSID)
          break
        case 'language':
          showLanguageView()
          break
      }
    }

    const scanNetworks = () => {
      scanSession?.close()
      scanResults = []
      status.wifi = SettingsStatusValue.SCANNING
      updateStatusLabels()
      updateNetworkList()
      let scanFinished = false
      const nextScanSession = scanWiFiNetworks({
        onFound: (result: RawWiFiScanResult) => {
          scanResults.push(result)
          updateNetworkList()
        },
        onComplete: () => {
          scanFinished = true
          scanSession = undefined
          if (status.wifi === SettingsStatusValue.SCANNING) status.wifi = SettingsStatusValue.NOT_CONNECTED
          updateStatusLabels()
          updateNetworkList()
        },
        onError: (message?: string) => {
          scanFinished = true
          scanSession = undefined
          trace(`Wi-Fi scan failed${message ? `: ${message}` : ''}\n`)
          status.wifi = SettingsStatusValue.FAILED
          updateStatusLabels()
        },
      })
      scanSession = scanFinished ? undefined : nextScanSession
    }

    const selectNetwork = (network: SettingsNetworkEntry) => {
      status['wifi.ssid'] = network.ssid
      Preference.set(DOMAIN.wifi, 'ssid', network.ssid)
      showPasswordView(network.ssid)
    }

    const testConnection = () => {
      if (status['wifi.ssid'].length === 0 || status['wifi.password'].length === 0) return
      stopStoredWiFiConnection()
      connectStoredWiFi({
        ssid: status['wifi.ssid'],
        password: status['wifi.password'],
        onStateChanged: (state: NetworkState) => {
          status.wifi = settingsWifiStatusFromNetworkState(state)
          updateStatusLabels()
        },
        onConnected: () => {
          trace('connection complete\n')
          status.wifi = SettingsStatusValue.CONNECTED
          updateStatusLabels()
        },
        onError: () => {
          trace('connection failed\n')
          status.wifi = SettingsStatusValue.FAILED
          updateStatusLabels()
        },
      })
    }
    showSettingsView()

    preferenceServer = new PreferenceServer({
      onPreferenceChanged: (key, value) => {
        trace(`preference changed! ${key}: ${value}\n`)
        if (key === `${DOMAIN.ui}.language`) {
          applyLanguage(value, false)
          return
        }
        status[key] = value
        updateStatusLabels()
      },
      onConnected: () => {
        status.ble = SettingsStatusValue.CONNECTED
        updateStatusLabels()
      },
      onDisconnected: () => {
        status.ble = SettingsStatusValue.NOT_CONNECTED
        updateStatusLabels()
      },
      keys: PREF_KEYS,
    })
  })
}
