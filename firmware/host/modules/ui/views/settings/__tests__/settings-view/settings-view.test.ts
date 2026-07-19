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
}
const state = {
  status,
  networks: [] as Array<{ ssid: string; signal: number; label: string }>,
  selectedSSID: 'stackchan-ap',
}
let navigatedView = -1
let exitCount = 0
let scanCount = 0
let cancelScanCount = 0
let bootCount = 0
let selectedSSID = ''
let password = ''

const context: SettingsViewContext = {
  state,
  actions: {
    exit() {
      exitCount += 1
    },
    boot() {
      bootCount += 1
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
  },
}

function mount(instance: SettingsViewInstance) {
  application.empty()
  application.add(instance.content)
  instance.update?.()
}

equal(settingsViews.length, 3, 'settings registry should contain menu, Wi-Fi, and password views')

const menuView = settingsViews[SettingsViewId.MENU].create(context)
equal(application.length, 0, 'creating a settings view should not mount it')
mount(menuView)
const menuScroller = menuView.content.last as PiuContainer
const menuItems = menuScroller.first as PiuContainer
const wifiMenuItem = menuItems.first as Touchable
press(wifiMenuItem)
equal(navigatedView, SettingsViewId.WIFI, 'Wi-Fi menu item should navigate through the shared action')

const menuHeader = menuView.content.first as PiuContainer
press(menuHeader.first as Touchable)
equal(exitCount, 1, 'settings menu back button should exit setup mode')

const wifiView = settingsViews[SettingsViewId.WIFI].create(context)
mount(wifiView)
const wifiHeader = wifiView.content.first as PiuContent
const wifiLabel = wifiHeader.next as PiuContent & { string?: string }
equal(wifiLabel.string, 'Wi-Fi: 未接続', 'Wi-Fi label should reflect status')
const scanButton = wifiLabel.next as Touchable
press(scanButton)
equal(scanCount, 1, 'pressing the visible scan action should request Wi-Fi scan')

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
const bootButton = scanButton.next as Touchable
equal(bootButton.active, true, 'connected settings should enable the boot action')
press(bootButton)
equal(bootCount, 1, 'connected settings should continue to the main application')
wifiView.dispose?.()
equal(cancelScanCount, 1, 'leaving the Wi-Fi view should cancel an active scan through the shared action')

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

trace('ok\n')
