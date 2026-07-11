import { Application } from 'piu/MC'
import {
  buildSettingsPasswordView,
  buildSettingsView,
  SettingsStatusValue,
  updateSettingsNetworkLabels,
  updateSettingsStatusLabels,
} from 'settings-view'
import { equal } from 'testing/assert'

trace('=== settings-view test ===\n')

let scanCount = 0
let bootCount = 0
let selectedSSID = ''
const application = new Application(null, {
  displayListLength: 4096,
  contents: [],
})

const labels = buildSettingsView(
  application,
  {
    ble: SettingsStatusValue.READY,
    wifi: SettingsStatusValue.NOT_CONNECTED,
    'wifi.ssid': 'stackchan-ap',
    'wifi.password': 'secret',
  },
  {
    onBoot() {
      bootCount += 1
    },
    onScan() {
      scanCount += 1
    },
    onSelectNetwork(network) {
      selectedSSID = network.ssid
    },
  },
)

equal(application.length, 1, 'settings view should replace application contents')
equal(labels.wifi.string, 'Wi-Fi: 未接続', 'Wi-Fi label should reflect status')
const scanButton = labels.scan as unknown as {
  behavior: {
    onTouchBegan: (container: unknown, id: number, x: number, y: number) => void
    onTouchEnded: (container: unknown) => void
  }
}
scanButton.behavior.onTouchBegan(scanButton, 0, 0, 0)
scanButton.behavior.onTouchEnded(scanButton)
equal(scanCount, 1, 'pressing the visible scan action should request Wi-Fi scan')

updateSettingsNetworkLabels(labels, [
  { ssid: 'stackchan-ap', signal: -42, label: 'stackchan-ap (-42 dBm)' },
  { ssid: 'guest-ap', signal: -76, label: 'guest-ap (-76 dBm)' },
])
equal(labels.networkState.networks.length, 2, 'network list should retain every scanned SSID for scroller rows')

const list = labels.list as unknown as {
  first: {
    behavior: {
      onTouchBegan: (port: unknown, id: number, x: number, y: number) => void
      onTouchEnded: (port: unknown) => void
    }
  }
}
list.first.behavior.onTouchBegan(list.first, 0, 0, 0)
list.first.behavior.onTouchEnded(list.first)
equal(selectedSSID, 'stackchan-ap', 'network row should select its SSID')

updateSettingsStatusLabels(labels, {
  ble: SettingsStatusValue.OFF,
  wifi: SettingsStatusValue.CONNECTED,
})

equal(labels.wifi.string, 'Wi-Fi: 接続済み', 'Wi-Fi label should update')
const bootButton = labels.boot as unknown as {
  active: boolean
  behavior: {
    onTouchBegan: (container: unknown, id: number, x: number, y: number) => void
    onTouchEnded: (container: unknown) => void
  }
}
equal(bootButton.active, true, 'connected settings should enable the boot action')
bootButton.behavior.onTouchBegan(bootButton, 0, 0, 0)
bootButton.behavior.onTouchEnded(bootButton)
equal(bootCount, 1, 'connected settings should continue to the main application')

let password = ''
buildSettingsPasswordView(application, 'stackchan-ap', {
  onPassword(value) {
    password = value
  },
})

equal(application.length, 1, 'password view should replace application contents')
const passwordRoot = application.first as unknown as {
  behavior: {
    onKeyboardOK: (container: unknown, value: string) => void
    onKeyboardTransitionFinished: (container: unknown, out: boolean) => void
  }
}
passwordRoot.behavior.onKeyboardOK(passwordRoot, 'new-secret')
passwordRoot.behavior.onKeyboardTransitionFinished(passwordRoot, true)
equal(password, 'new-secret', 'password view should submit expanding keyboard input')

trace('ok\n')
