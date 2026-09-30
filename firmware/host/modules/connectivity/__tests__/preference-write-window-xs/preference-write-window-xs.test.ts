import { PREF_KEYS } from 'consts'
import Preference from 'preference'
import { PreferenceServer } from 'preference-server'
import { equal } from 'testing/assert'
import Timer from 'timer'

const server = new PreferenceServer({ keys: PREF_KEYS })
server.receiveAndSetPreference('wifi', 'ssid', 'closed')
equal(Preference.get('wifi', 'ssid'), undefined, 'new servers must reject writes')

server.enableWrites(20)
server.onRX(ArrayBuffer.fromString('{"_batch":{"wifi.ssid":"allowed","wifi.ssid.extra":"rejected"}}'))
equal(Preference.get('wifi', 'ssid'), 'allowed', 'only the exact supported key should be applied')
server.onRX(ArrayBuffer.fromString('{"prop":"wifi.password","value":'))

Timer.set(() => {
  server.onRX(ArrayBuffer.fromString('"expired"}'))
  server.receiveAndSetPreference('wifi', 'ssid', 'expired')
  equal(Preference.get('wifi', 'ssid'), 'allowed', 'native Timer expiry must close the window')
  equal(Preference.get('wifi', 'password'), undefined, 'fragments cannot cross expiry')

  server.enableWrites(20)
  server.onRX(ArrayBuffer.fromString('{"prop":"wifi.password","value":"fresh"}'))
  equal(Preference.get('wifi', 'password'), 'fresh', 'a new window should accept a clean message')
  server.close()
  server.enableWrites(20)
  server.receiveAndSetPreference('wifi', 'password', 'closed')
  equal(Preference.get('wifi', 'password'), 'fresh', 'closed servers cannot reopen')
  trace('ok\n')
}, 40)
