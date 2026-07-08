import { Application } from 'piu/MC'
import {
  buildSettingsPasswordView,
  buildSettingsView,
  SettingsStatusValue,
  updateSettingsStatusLabels,
} from 'settings-view'
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
    ble: SettingsStatusValue.READY,
    wifi: SettingsStatusValue.NOT_CONNECTED,
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
equal(labels.wifi.string, 'Wi-Fi: not connected', 'Wi-Fi label should reflect status')
equal(labels.hint.string, 'Tap to test connection', 'hint label should describe touch action')

const root = application.first as unknown as {
  behavior: {
    onTouchEnded: (container: unknown) => void
  }
}
root.behavior.onTouchEnded(root)
equal(connectCount, 1, 'touch should request a connection test')

updateSettingsStatusLabels(labels, {
  ble: SettingsStatusValue.OFF,
  wifi: SettingsStatusValue.CONNECTED,
})

equal(labels.ble.string, 'BLE: off', 'BLE label should update')
equal(labels.ssid.string, 'SSID: not set', 'SSID label should fall back when unset')
equal(labels.password.string, 'password: not set', 'password label should fall back when unset')
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
