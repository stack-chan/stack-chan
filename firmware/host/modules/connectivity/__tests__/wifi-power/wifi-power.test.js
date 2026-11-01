import power from 'network-power'
import { NetworkService } from 'network-service'
import { equal } from 'testing/assert'
import { state } from 'wifi-power-save'

const first = new NetworkService({ ssid: 'test.invalid' })
equal(power.getWiFiPowerSaveMode(), 'min-modem', 'idle policy')
const old = power.acquireLowLatency()
const current = power.acquireLowLatency()
first.connect()
first.close()
// Recreating NetworkService must not reset other owners.
const next = new NetworkService({ ssid: 'test.invalid' })
equal(power.getWiFiPowerSaveMode(), 'none', 'preserve leases across initialization')
old.close()
old.close()
next.connect()
equal(power.getWiFiPowerSaveMode(), 'none', 'old close cannot release current owner')
next.close()
current.close()
equal(power.getWiFiPowerSaveMode(), 'min-modem', 'last release restores idle')
equal(state.connects, 2, 'both connection attempts exercised')
state.fail = true
let initializationFailed = false
try {
  new NetworkService({ ssid: 'test.invalid' })
} catch {
  initializationFailed = true
}
equal(initializationFailed, true, 'initialization error is observable')
equal(state.closed, 3, 'failed constructor closes its Wi-Fi handle')
state.fail = false
const failed = new NetworkService({ ssid: 'test.invalid' })
state.fail = true
let connectionFailed = false
failed.connect(
  () => {},
  () => {
    connectionFailed = true
  },
)
equal(connectionFailed, true, 'policy failure uses connection error callback')
equal(state.connects, 2, 'policy failure prevents connecting')
failed.close()
state.fail = false
trace('@@STACKCHAN_TEST:PASS@@\n')
