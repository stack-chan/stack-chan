import { getSettingsService, loadPreferenceConfig } from 'loadPreference'
import { DOMAIN } from 'consts'
import { getLocalizationLanguage, type SupportedLocale, setLocalizationLanguage } from 'localization'
import { type NetworkConnection, openNetworkConnection } from 'network-manager'
import { NetworkConnectionState, type NetworkConnectionState as NetworkState } from 'network-state'
import { OwnedResources } from 'owned-resources'
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
import Speaker from 'speaker'
import { asStackchanError } from 'stackchan/errors'
import { applyTimezone as applySystemTimezone, type TimezoneId } from 'timezone-settings'
import { canonicalizeVolume } from 'volume-model'
import { VolumePreviewQueue } from 'volume-preview'
import { scanWiFiNetworks } from 'wifi-scan'
import type { WiFiScanSession } from 'wifi-scan-types'

export type SetupModeResult = 'back' | 'boot'

const VOLUME_PREVIEW_FREQUENCY_HZ = 1000
const VOLUME_PREVIEW_DURATION_MS = 120

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
  return new Promise((resolve, reject) => {
    const settings = getSettingsService()
    const preferences = loadPreferenceConfig()
    preferences.time.timezone = applySystemTimezone(preferences.time.timezone)
    preferences.tts.volume = canonicalizeVolume(preferences.tts.volume)
    const status = createInitialSettingsStatus(preferences)
    const viewState = {
      status,
      networks: [] as SettingsNetworkEntry[],
      selectedSSID: '',
      language: getLocalizationLanguage(),
      timezone: preferences.time.timezone as TimezoneId,
      volume: preferences.tts.volume as number,
    }
    const volumeSpeaker = new Speaker({ volume: viewState.volume })
    const volumePreviewQueue = new VolumePreviewQueue({
      play: (volume) => volumeSpeaker.tone(VOLUME_PREVIEW_FREQUENCY_HZ, VOLUME_PREVIEW_DURATION_MS, volume),
      onError: (error) => trace(`[settings] volume preview failed: ${String(error)}\n`),
    })
    let currentView: SettingsViewInstance | undefined
    let currentViewId: SettingsViewId = SettingsViewId.MENU
    let scanSession: WiFiScanSession | undefined
    let scanResults: RawWiFiScanResult[] = []
    let preferenceServer: PreferenceServer | undefined
    let networkConnection: NetworkConnection | undefined
    let finished = false
    const resources = new OwnedResources([
      () => cancelWifiScan(),
      () => {
        const view = currentView
        currentView = undefined
        view?.dispose?.()
      },
      () => {
        const server = preferenceServer
        preferenceServer = undefined
        server?.close()
      },
      () => {
        const connection = networkConnection
        networkConnection = undefined
        connection?.close()
      },
      () => volumePreviewQueue.close(),
      () => volumeSpeaker.close(),
    ])

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
        selectLanguage: (locale: SupportedLocale) => {
          if (saveSettings({ 'ui.language': locale })) applyLanguage(locale)
        },
        saveTimezone,
        saveVolume,
      },
    }

    function finish(result: SetupModeResult, failure?: unknown) {
      if (finished) return
      finished = true
      void resources.close().then(
        () => {
          if (failure !== undefined) reject(asStackchanError(failure))
          else resolve(result)
        },
        (error) => reject(asStackchanError(error)),
      )
    }

    function saveSettings(values: Record<string, unknown>): boolean {
      if (finished) return false
      try {
        settings.write(values)
        return true
      } catch {
        trace('[settings] save failed\n')
        showView(SettingsViewId.ERROR)
        return false
      }
    }

    function clearWiFiAndBootOffline() {
      if (!saveSettings({ 'wifi.ssid': '', 'wifi.password': '' })) return
      status['wifi.ssid'] = ''
      status['wifi.password'] = ''
      status.wifi = SettingsStatusValue.NOT_CONNECTED
      trace('[network] saved Wi-Fi credentials cleared for offline boot\n')
      finish('boot')
    }

    function showView(id: SettingsViewId) {
      if (finished) return
      const previous = currentView
      currentView = undefined
      previous?.dispose?.()
      const nextView = settingsViews[id].create(viewContext)
      currentView = nextView
      application.empty()
      application.add(nextView.content)
      currentViewId = id
      currentView.update?.()
    }

    function updateCurrentView() {
      if (finished) return
      currentView?.update?.()
    }

    function updateNetworkList() {
      viewState.networks = createSettingsNetworkEntries(scanResults)
      updateCurrentView()
    }

    function cancelWifiScan() {
      const session = scanSession
      scanSession = undefined
      session?.close()
      if (status.wifi === SettingsStatusValue.SCANNING) status.wifi = SettingsStatusValue.NOT_CONNECTED
    }

    function applyLanguage(value: unknown) {
      const locale = setLocalizationLanguage(value)
      status['ui.language'] = locale
      viewState.language = locale
      showView(currentViewId)
    }

    function applyTimezone(value: unknown) {
      const timezone = applySystemTimezone(value)
      status['time.timezone'] = timezone
      viewState.timezone = timezone
      return timezone
    }

    function saveTimezone(value: TimezoneId) {
      if (!saveSettings({ 'time.timezone': value })) return
      applyTimezone(value)
      showView(SettingsViewId.MENU)
    }

    function applyVolume(value: unknown, preview: boolean) {
      const volume = canonicalizeVolume(value)
      status['tts.volume'] = volume
      viewState.volume = volume
      updateCurrentView()
      if (preview) volumePreviewQueue.request(volume)
      return volume
    }

    function saveVolume(value: number) {
      if (saveSettings({ 'tts.volume': value })) applyVolume(value, true)
    }

    function scanNetworks() {
      if (finished) return
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
      viewState.selectedSSID = network.ssid
      showView(SettingsViewId.PASSWORD)
    }

    function submitWifiPassword(password: string) {
      if (!saveSettings({ 'wifi.ssid': viewState.selectedSSID, 'wifi.password': password })) return
      status['wifi.ssid'] = viewState.selectedSSID
      status['wifi.password'] = password
      showView(SettingsViewId.WIFI)
      testConnection()
    }

    function testConnection() {
      if (finished || !status['wifi.ssid']) return
      try {
        const previous = networkConnection
        networkConnection = undefined
        previous?.close()
        const connection = openNetworkConnection({
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
        if (finished) connection.close()
        else networkConnection = connection
      } catch {
        status.wifi = SettingsStatusValue.FAILED
        updateCurrentView()
      }
    }
    try {
      showView(SettingsViewId.MENU)

      preferenceServer = new PreferenceServer({
        settings,
        onPreferenceChanged: (key, value) => {
          if (finished) return
          trace(`preference changed! ${key}\n`)
          if (key === `${DOMAIN.ui}.language`) {
            applyLanguage(value)
            return
          }
          if (key === `${DOMAIN.time}.timezone`) {
            applyTimezone(value)
            showView(currentViewId)
            return
          }
          if (key === `${DOMAIN.tts}.volume`) {
            applyVolume(value, false)
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
      })
    } catch (error) {
      finish('back', error)
    }
  })
}
