import type { LocalPeerRadioRegistry } from 'local-peer-radio-types'

const localPeerRadioRegistry: LocalPeerRadioRegistry = {
  defaultTransport: 'ble',
  factories: {},
}

export default localPeerRadioRegistry
