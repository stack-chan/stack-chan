import createBLELocalPeerRadio from 'ble-local-peer-radio'
import type { LocalPeerRadioRegistry } from 'local-peer-radio-types'

const localPeerRadioRegistry: LocalPeerRadioRegistry = {
  defaultTransport: 'ble',
  factories: { ble: createBLELocalPeerRadio },
}

export default localPeerRadioRegistry
