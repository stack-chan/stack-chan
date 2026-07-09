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
    onScan() {
      scanCount += 1
    },
    onSelectNetwork(network) {
      selectedSSID = network.ssid
    },
  },
)

equal(application.length, 1, 'settings view should replace application contents')
equal(labels.wifi.string, 'Wi-Fi: not connected', 'Wi-Fi label should reflect status')
equal(labels.scan.string, 'Scan Wi-Fi', 'scan label should request scan')

const root = application.first as unknown as {
  behavior: {
    onTouchEnded: (container: unknown, id: number, x: number, y: number) => void
  }
}
root.behavior.onTouchEnded(root, 0, 10, 70)
equal(scanCount, 1, 'touching scan row should request Wi-Fi scan')

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

equal(labels.wifi.string, 'Wi-Fi: connected', 'Wi-Fi label should update')

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
