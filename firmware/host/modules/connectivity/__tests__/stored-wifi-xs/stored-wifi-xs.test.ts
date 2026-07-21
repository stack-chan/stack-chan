import * as networkManager from 'network-manager'
import Preference from 'preference'
import { clearStoredWiFiCredentials } from 'stored-wifi'
import { equal } from 'testing/assert'

const networkManagerTest = networkManager as unknown as {
  getStopCount(): number
  resetNetworkManager(): void
}

Preference.set('wifi', 'ssid', 'stored-ap')
Preference.set('wifi', 'password', 'stored-secret')
networkManagerTest.resetNetworkManager()

clearStoredWiFiCredentials()

equal(networkManagerTest.getStopCount(), 1, 'clearing Wi-Fi credentials should stop the active connection')
equal(Preference.get('wifi', 'ssid'), '', 'clearing Wi-Fi should persist an empty SSID override')
equal(Preference.get('wifi', 'password'), '', 'clearing Wi-Fi should persist an empty password override')

trace('ok\n')
