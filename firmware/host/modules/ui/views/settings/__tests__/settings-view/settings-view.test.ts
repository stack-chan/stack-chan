import { Application } from 'piu/MC'
import { buildSettingsView, updateSettingsStatusLabels } from 'settings-view'
import { equal } from 'testing/assert'

trace('=== settings-view test ===\n')

let connectCount = 0
const application = new Application(null, {
  displayListLength: 4096,
  contents: [],
})

const labels = buildSettingsView(
  application,
  {
    ble: 'ready',
    wifi: 'disconnected',
    'wifi.ssid': 'stackchan-ap',
    'wifi.password': 'secret',
  },
  {
    onConnect() {
      connectCount += 1
    },
  },
)

equal(application.length, 1, 'settings view should replace application contents')
equal(labels.ble.string, 'BLE: ready', 'BLE label should reflect status')
equal(labels.ssid.string, 'SSID: stackchan-ap', 'SSID label should reflect configured SSID')
equal(labels.password.string, 'password: ******', 'password label should be masked')
equal(labels.wifi.string, 'Wi-Fi: disconnected', 'Wi-Fi label should reflect status')
equal(labels.hint.string, 'Tap to test connection', 'hint label should describe touch action')

const root = application.first as unknown as {
  behavior: {
    onTouchEnded: (container: unknown) => void
  }
}
root.behavior.onTouchEnded(root)
equal(connectCount, 1, 'touch should request a connection test')

updateSettingsStatusLabels(labels, {
  ble: 'off',
  wifi: 'connected',
})

equal(labels.ble.string, 'BLE: off', 'BLE label should update')
equal(labels.ssid.string, 'SSID: not set', 'SSID label should fall back when unset')
equal(labels.password.string, 'password: not set', 'password label should fall back when unset')
equal(labels.wifi.string, 'Wi-Fi: connected', 'Wi-Fi label should update')

trace('ok\n')
