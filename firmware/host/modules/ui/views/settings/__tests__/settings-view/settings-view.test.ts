import { setLocalizationLanguage } from 'localization'
import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import { Application } from 'piu/MC'
import {
  type SettingsStatus,
  SettingsStatusValue,
  type SettingsViewContext,
  SettingsViewId,
  type SettingsViewInstance,
  settingsViews,
} from 'settings-view'
import { equal } from 'testing/assert'

trace('=== settings-view test ===\n')

type Touchable = PiuContent & {
  active?: boolean
  behavior: {
    onTouchBegan: (content: unknown, id: number, x: number, y: number) => void
    onTouchEnded: (content: unknown) => void
  }
}

type VolumeSlider = PiuContent & {
  x: number
  width: number
  behavior: {
    onTouchBegan: (content: unknown, id: number, x: number, y: number) => void
    onTouchMoved: (content: unknown, id: number, x: number, y: number) => void
    onTouchCancelled: (content: unknown) => void
    onTouchEnded: (content: unknown, id: number, x: number, y: number) => void
  }
}

function press(content: Touchable) {
  content.behavior.onTouchBegan(content, 0, 0, 0)
  content.behavior.onTouchEnded(content)
}

const application = new Application(null, {
  displayListLength: 4096,
  contents: [],
})
const status: SettingsStatus = {
  ble: SettingsStatusValue.READY,
  wifi: SettingsStatusValue.NOT_CONNECTED,
  'wifi.ssid': 'stackchan-ap',
  'wifi.password': 'secret',
  'tts.volume': 0.35,
}
const state = {
  status,
  networks: [] as Array<{ ssid: string; signal: number; label: string }>,
  selectedSSID: 'stackchan-ap',
  language: 'ja' as const,
  timezone: 'tokyo' as const,
  volume: 0.35,
}
let navigatedView = -1
let exitCount = 0
let scanCount = 0
let cancelScanCount = 0
let bootCount = 0
let offlineBootCount = 0
let selectedSSID = ''
let password = ''
let selectedLanguage = ''
let selectedTimezone = ''
let selectedVolume = -1
let volumeSaveCount = 0

const context: SettingsViewContext = {
  state,
  actions: {
    exit() {
      exitCount += 1
    },
    boot() {
      bootCount += 1
    },
    bootOffline() {
      offlineBootCount += 1
    },
    navigate(view) {
      navigatedView = view
    },
    scanWifi() {
      scanCount += 1
    },
    cancelWifiScan() {
      cancelScanCount += 1
    },
    selectWifiNetwork(network) {
      selectedSSID = network.ssid
    },
    submitWifiPassword(value) {
      password = value
    },
    selectLanguage(locale) {
      selectedLanguage = locale
    },
    saveTimezone(timezone) {
      selectedTimezone = timezone
    },
    saveVolume(volume) {
      selectedVolume = volume
      volumeSaveCount += 1
    },
  },
}

function mount(instance: SettingsViewInstance) {
  application.empty()
  application.add(instance.content)
  instance.update?.()
}

equal(
  settingsViews.length,
  7,
  'settings registry should contain menu, Wi-Fi, password, language, offline, time zone, and volume views',
)

const menuView = settingsViews[SettingsViewId.MENU].create(context)
equal(application.length, 0, 'creating a settings view should not mount it')
mount(menuView)
const menuScroller = menuView.content.last as PiuContainer
const menuItems = menuScroller.first as PiuContainer
const wifiMenuItem = menuItems.first as Touchable
press(wifiMenuItem)
equal(navigatedView, SettingsViewId.WIFI, 'Wi-Fi menu item should navigate through the shared action')
const volumeMenuItem = wifiMenuItem.next as Touchable
press(volumeMenuItem)
equal(navigatedView, SettingsViewId.VOLUME, 'volume menu item should navigate through the shared action')
const timezoneMenuItem = volumeMenuItem.next as Touchable
press(timezoneMenuItem)
equal(navigatedView, SettingsViewId.TIMEZONE, 'time zone menu item should navigate through the shared action')
const languageMenuItem = timezoneMenuItem.next as Touchable
press(languageMenuItem)
equal(navigatedView, SettingsViewId.LANGUAGE, 'language menu item should navigate through the shared action')

const menuHeader = menuView.content.first as PiuContainer
press(menuHeader.first as Touchable)
equal(exitCount, 1, 'settings menu back button should exit setup mode')

const volumeView = settingsViews[SettingsViewId.VOLUME].create(context)
mount(volumeView)
const volumeHeader = volumeView.content.first as PiuContainer
const volumeLabel = volumeHeader.next as PiuContent & { string?: string }
const volumeSlider = volumeLabel.next as VolumeSlider
equal(volumeLabel.string, '音量: 35%', 'volume view should show the persisted value as a percentage')

const leftOfSlider = volumeSlider.x - 100
const rightOfSlider = volumeSlider.x + volumeSlider.width + 100
volumeSlider.behavior.onTouchBegan(volumeSlider, 0, leftOfSlider, 0)
volumeSlider.behavior.onTouchMoved(volumeSlider, 0, rightOfSlider, 0)
equal(volumeLabel.string, '音量: 100%', 'dragging should update the visible volume before committing')
equal(volumeSaveCount, 0, 'dragging should not persist intermediate values')
volumeSlider.behavior.onTouchEnded(volumeSlider, 0, rightOfSlider, 0)
equal(selectedVolume, 1, 'releasing the slider should persist the selected volume')
equal(volumeSaveCount, 1, 'releasing the slider should persist exactly once')

volumeSlider.behavior.onTouchBegan(volumeSlider, 0, leftOfSlider, 0)
equal(volumeLabel.string, '音量: 0%', 'a new drag should update the draft value immediately')
volumeSlider.behavior.onTouchCancelled(volumeSlider)
equal(volumeLabel.string, '音量: 100%', 'cancelling a drag should restore the committed value')
equal(volumeSaveCount, 1, 'cancelling a drag should not persist or preview the draft')

volumeSlider.behavior.onTouchBegan(volumeSlider, 0, rightOfSlider, 0)
volumeSlider.behavior.onTouchEnded(volumeSlider, 0, rightOfSlider, 0)
equal(volumeSaveCount, 1, 'releasing at the current value should not persist again')

state.volume = 0.25
volumeView.update?.()
equal(volumeLabel.string, '音量: 25%', 'external volume changes should refresh the slider without a local save')
equal(volumeSaveCount, 1, 'external volume changes should not invoke the local save action')
press(volumeHeader.first as Touchable)
equal(navigatedView, SettingsViewId.MENU, 'volume back button should return to settings')

const wifiView = settingsViews[SettingsViewId.WIFI].create(context)
mount(wifiView)
const wifiHeader = wifiView.content.first as PiuContent
const wifiLabel = wifiHeader.next as PiuContent & { string?: string }
equal(wifiLabel.string, 'Wi-Fi: 未接続', 'Wi-Fi label should reflect status')
const scanButton = wifiLabel.next as Touchable
press(scanButton)
equal(scanCount, 1, 'pressing the visible scan action should request Wi-Fi scan')

const bootButton = scanButton.next as Touchable
equal(bootButton.active, true, 'disconnected settings should enable the offline action')
press(bootButton)
equal(navigatedView, SettingsViewId.OFFLINE, 'disconnected settings should navigate to offline confirmation')

status.wifi = SettingsStatusValue.SYNCING_TIME
wifiView.update?.()
equal(bootButton.active, false, 'time synchronization should keep boot and offline actions disabled')

state.networks = [
  { ssid: 'stackchan-ap', signal: -42, label: 'stackchan-ap (-42 dBm)' },
  { ssid: 'guest-ap', signal: -76, label: 'guest-ap (-76 dBm)' },
]
wifiView.update?.()
const networkScroller = wifiView.content.last as PiuContainer
const list = networkScroller.first as PiuContainer
equal(list.length, 2, 'network list should retain every scanned SSID for scroller rows')
press(list.first as Touchable)
equal(selectedSSID, 'stackchan-ap', 'network row should select its SSID')

const firstNetworkRow = list.first
status.wifi = SettingsStatusValue.CONNECTED
wifiView.update?.()
equal(wifiLabel.string, 'Wi-Fi: 接続済み', 'Wi-Fi label should update')
equal(list.first, firstNetworkRow, 'status-only updates should preserve existing network rows')
equal(bootButton.active, true, 'connected settings should enable the boot action')
press(bootButton)
equal(bootCount, 1, 'connected settings should continue to the main application')
wifiView.dispose?.()
equal(cancelScanCount, 1, 'leaving the Wi-Fi view should cancel an active scan through the shared action')

const offlineView = settingsViews[SettingsViewId.OFFLINE].create(context)
mount(offlineView)
const offlineHeader = offlineView.content.first as PiuContainer
press(offlineHeader.first as Touchable)
equal(navigatedView, SettingsViewId.WIFI, 'offline confirmation back button should return to Wi-Fi settings')
press(offlineView.content.last as Touchable)
equal(offlineBootCount, 1, 'offline confirmation should require the explicit destructive action')

const passwordView = settingsViews[SettingsViewId.PASSWORD].create(context)
mount(passwordView)
const passwordRoot = passwordView.content as unknown as {
  behavior: {
    onKeyboardOK: (container: unknown, value: string) => void
    onKeyboardTransitionFinished: (container: unknown, out: boolean) => void
  }
}
passwordRoot.behavior.onKeyboardOK(passwordRoot, 'new-secret')
passwordRoot.behavior.onKeyboardTransitionFinished(passwordRoot, true)
equal(password, 'new-secret', 'password view should submit expanding keyboard input')

const languageView = settingsViews[SettingsViewId.LANGUAGE].create(context)
mount(languageView)
const languageRoot = languageView.content as unknown as {
  first: {
    next: {
      next: {
        behavior: {
          onTouchBegan: (container: unknown, id: number, x: number, y: number) => void
          onTouchEnded: (container: unknown) => void
        }
      }
    }
  }
}
const englishButton = languageRoot.first.next.next
englishButton.behavior.onTouchBegan(englishButton, 0, 0, 0)
englishButton.behavior.onTouchEnded(englishButton)
equal(selectedLanguage, 'en', 'language view should expose English as a touch action')

const timezoneDraftView = settingsViews[SettingsViewId.TIMEZONE].create(context)
mount(timezoneDraftView)
const timezoneDraftHeader = timezoneDraftView.content.first as PiuContainer
const timezoneDraftScroller = timezoneDraftHeader.next as PiuContainer
const timezoneDraftChoices = timezoneDraftScroller.first as PiuContainer
let londonButton = timezoneDraftChoices.first as Touchable
for (let index = 0; index < 6; index += 1) londonButton = londonButton.next as Touchable
press(londonButton)
equal(selectedTimezone, '', 'choosing a city should remain a draft until Save is pressed')
press(timezoneDraftHeader.first as Touchable)
equal(navigatedView, SettingsViewId.MENU, 'time zone back button should discard the draft and return to settings')

const resetTimezoneView = settingsViews[SettingsViewId.TIMEZONE].create(context)
mount(resetTimezoneView)
equal(selectedTimezone, '', 'recreating the time zone view should leave the discarded draft uncommitted')
press(resetTimezoneView.content.last as Touchable)
equal(selectedTimezone, 'tokyo', 'saving the recreated view should use the persisted time zone')

const timezoneSaveView = settingsViews[SettingsViewId.TIMEZONE].create(context)
mount(timezoneSaveView)
const timezoneSaveHeader = timezoneSaveView.content.first as PiuContainer
const timezoneSaveScroller = timezoneSaveHeader.next as PiuContainer
const timezoneSaveChoices = timezoneSaveScroller.first as PiuContainer
londonButton = timezoneSaveChoices.first as Touchable
for (let index = 0; index < 6; index += 1) londonButton = londonButton.next as Touchable
press(londonButton)
equal(selectedTimezone, 'tokyo', 'a fresh time zone selection should remain a draft until Save is pressed')
const timezoneSave = timezoneSaveView.content.last as Touchable
press(timezoneSave)
equal(selectedTimezone, 'london', 'time zone Save should commit the selected city')

setLocalizationLanguage('en')
status.wifi = SettingsStatusValue.NOT_CONNECTED
const englishView = settingsViews[SettingsViewId.WIFI].create(context)
mount(englishView)
const englishHeader = englishView.content.first as PiuContent
const englishLabel = englishHeader.next as PiuContent & { string?: string }
equal(englishLabel.string, 'Wi-Fi: Disconnected', 'settings view should switch to English immediately')

setLocalizationLanguage('zh-CN')
status.wifi = SettingsStatusValue.CONNECTED
const chineseView = settingsViews[SettingsViewId.WIFI].create(context)
mount(chineseView)
const chineseHeader = chineseView.content.first as PiuContent
const chineseLabel = chineseHeader.next as PiuContent & { string?: string }
equal(chineseLabel.string, 'Wi-Fi：已连接', 'settings view should switch to Simplified Chinese immediately')
setLocalizationLanguage('ja')

trace('ok\n')
