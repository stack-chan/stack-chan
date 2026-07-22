import createBLELocalPeerRadio from 'ble-local-peer-radio'
import createESPNowLocalPeerRadio from 'local-peer-radio'
import type { LocalPeerRadioRegistry } from 'local-peer-radio-types'

const localPeerRadioRegistry: LocalPeerRadioRegistry = {
  defaultTransport: 'espnow',
  factories: {
    espnow: createESPNowLocalPeerRadio,
    ble: createBLELocalPeerRadio,
  },
}

export default localPeerRadioRegistry
