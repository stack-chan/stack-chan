import { loadPreferenceConfig } from 'loadPreference'
import { DOMAIN, PREF_KEYS } from 'consts'
import { getLocalizationLanguage, normalizeLocale, type SupportedLocale, setLocalizationLanguage } from 'localization'
import { NetworkConnectionState, type NetworkConnectionState as NetworkState } from 'network-state'
import Preference from 'preference'
import { PreferenceServer } from 'preference-server'
import { createSettingsNetworkEntries, type RawWiFiScanResult, type SettingsNetworkEntry } from 'settings-network-list'
import { createInitialSettingsStatus } from 'settings-status'
import {
  type SettingsApplication,
  SettingsStatusValue,
  type SettingsViewContext,
  SettingsViewId,
  type SettingsViewInstance,
  settingsViews,
} from 'settings-view'
import { clearStoredWiFiCredentials, connectStoredWiFi, stopStoredWiFiConnection } from 'stored-wifi'
import { scanWiFiNetworks } from 'wifi-scan'
import type { WiFiScanSession } from 'wifi-scan-types'

export type SetupModeResult = 'back' | 'boot'

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

export function startSetupMode(application: SettingsApplication): Promise<SetupModeResult> {
  return new Promise((resolve) => {
    const preferences = loadPreferenceConfig()
    const status = createInitialSettingsStatus(preferences)
    const effectiveValues = Object.fromEntries(
      PREF_KEYS.flatMap(([domain, key]) => {
        const value = preferences[domain]?.[key]
        return value == null ? [] : [[`${domain}.${key}`, value]]
      }),
    )
    const viewState = {
      status,
      networks: [] as SettingsNetworkEntry[],
      selectedSSID: '',
      language: getLocalizationLanguage(),
    }
    let currentView: SettingsViewInstance | undefined
    let currentViewId: SettingsViewId = SettingsViewId.MENU
    let scanSession: WiFiScanSession | undefined
    let scanResults: RawWiFiScanResult[] = []
    let preferenceServer: PreferenceServer | undefined
    let finished = false

    const viewContext: SettingsViewContext = {
      state: viewState,
      actions: {
        exit: () => finish('back'),
        boot: () => finish('boot'),
        bootOffline: clearWiFiAndBootOffline,
        navigate: showView,
        scanWifi: scanNetworks,
        cancelWifiScan,
        selectWifiNetwork: selectNetwork,
        submitWifiPassword,
        selectLanguage: (locale: SupportedLocale) => applyLanguage(locale, true),
      },
    }

    function finish(result: SetupModeResult) {
      if (finished) return
      finished = true
      currentView?.dispose?.()
      currentView = undefined
      preferenceServer?.close?.()
      if (result === 'back') stopStoredWiFiConnection()
      resolve(result)
    }

    function clearWiFiAndBootOffline() {
      clearStoredWiFiCredentials()
      status['wifi.ssid'] = ''
      status['wifi.password'] = ''
      status.wifi = SettingsStatusValue.NOT_CONNECTED
      trace('[network] saved Wi-Fi credentials cleared for offline boot\n')
      finish('boot')
    }

    function showView(id: SettingsViewId) {
      currentView?.dispose?.()
      const nextView = settingsViews[id].create(viewContext)
      application.empty()
      application.add(nextView.content)
      currentView = nextView
      currentViewId = id
      currentView.update?.()
    }

    function updateCurrentView() {
      currentView?.update?.()
    }

    function updateNetworkList() {
      viewState.networks = createSettingsNetworkEntries(scanResults)
      updateCurrentView()
    }

    function cancelWifiScan() {
      scanSession?.close()
      scanSession = undefined
      if (status.wifi === SettingsStatusValue.SCANNING) status.wifi = SettingsStatusValue.NOT_CONNECTED
    }

    function applyLanguage(value: unknown, persist: boolean) {
      const locale = setLocalizationLanguage(value)
      status['ui.language'] = locale
      viewState.language = locale
      if (persist || normalizeLocale(value) !== locale) Preference.set(DOMAIN.ui, 'language', locale)
      showView(currentViewId)
    }

    function scanNetworks() {
      cancelWifiScan()
      scanResults = []
      status.wifi = SettingsStatusValue.SCANNING
      updateCurrentView()
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
          updateCurrentView()
          updateNetworkList()
        },
        onError: (message?: string) => {
          scanFinished = true
          scanSession = undefined
          trace(`Wi-Fi scan failed${message ? `: ${message}` : ''}\n`)
          status.wifi = SettingsStatusValue.FAILED
          updateCurrentView()
        },
      })
      scanSession = scanFinished ? undefined : nextScanSession
    }

    function selectNetwork(network: SettingsNetworkEntry) {
      status['wifi.ssid'] = network.ssid
      viewState.selectedSSID = network.ssid
      Preference.set(DOMAIN.wifi, 'ssid', network.ssid)
      showView(SettingsViewId.PASSWORD)
    }

    function submitWifiPassword(password: string) {
      status['wifi.password'] = password
      Preference.set(DOMAIN.wifi, 'password', password)
      showView(SettingsViewId.WIFI)
      testConnection()
    }

    function testConnection() {
      if (status['wifi.ssid'].length === 0 || status['wifi.password'].length === 0) return
      stopStoredWiFiConnection()
      connectStoredWiFi({
        ssid: status['wifi.ssid'],
        password: status['wifi.password'],
        onStateChanged: (state: NetworkState) => {
          status.wifi = settingsWifiStatusFromNetworkState(state)
          updateCurrentView()
        },
        onConnected: () => {
          trace('connection complete\n')
          status.wifi = SettingsStatusValue.CONNECTED
          updateCurrentView()
        },
        onError: () => {
          trace('connection failed\n')
          status.wifi = SettingsStatusValue.FAILED
          updateCurrentView()
        },
      })
    }
    showView(SettingsViewId.MENU)

    preferenceServer = new PreferenceServer({
      onPreferenceChanged: (key, value) => {
        trace(`preference changed! ${key}\n`)
        if (key === `${DOMAIN.ui}.language`) {
          applyLanguage(value, false)
          return
        }
        status[key] = value
        updateCurrentView()
      },
      onConnected: () => {
        status.ble = SettingsStatusValue.CONNECTED
        updateCurrentView()
      },
      onDisconnected: () => {
        status.ble = SettingsStatusValue.NOT_CONNECTED
        updateCurrentView()
      },
      keys: PREF_KEYS,
      effectiveValues,
      readOnlyKeys: preferences.driver.typeLocked === true ? ['driver.type'] : [],
    })
  })
}
