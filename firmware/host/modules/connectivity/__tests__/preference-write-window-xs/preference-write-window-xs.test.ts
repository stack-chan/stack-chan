import { PREF_KEYS } from 'consts'
import Preference from 'preference'
import { PreferenceServer } from 'preference-server'
import { equal } from 'testing/assert'
import Time from 'time'
import Timer from 'timer'

// Native clock expiry must deny writes even while Timer callbacks cannot run.
const delayed = new PreferenceServer({ keys: PREF_KEYS })
Preference.set('tts', 'volume', '0.20')
let callbackRan = false
const witness = Timer.set(() => {
  callbackRan = true
}, 20)
delayed.enableWrites(20)
const started = Time.ticks
delayed.onRX(ArrayBuffer.fromString('{"prop":"tts.volume","value":'))
Timer.delay(30)
equal(callbackRan, false, 'blocking the JS turn must defer Timer callbacks')
equal(Time.delta(started) >= 20, true, 'actual elapsed clock must cross the write deadline')
delayed.onRX(ArrayBuffer.fromString('"0.21"}'))
delayed.onRX(ArrayBuffer.fromString('{"_batch":{"tts.volume":"0.22"}}'))
delayed.onDisconnected()
delayed.onConnected()
delayed.receiveAndSetPreference('tts', 'volume', '0.23')
equal(Preference.get('tts', 'volume'), '0.20', 'late writes cannot await Timer dispatch for denial')
Timer.clear(witness)
delayed.enableWrites(1000)
delayed.onRX(ArrayBuffer.fromString('{"prop":"tts.volume","value":"0.21"}'))
equal(Preference.get('tts', 'volume'), '0.21', 'fresh windows work after elapsed-time cleanup')
delayed.close()

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
