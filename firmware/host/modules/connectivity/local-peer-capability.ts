import { LocalPeerService } from 'local-peer-service'
import localPeerRadioRegistry from 'local-peer-transports'
import getMacAddress from 'mac-address'
import config from 'mc/config'

// The platform manifest binds `local-peer-radio`; this composition root is the
// only layer that connects the public communication contract to a radio driver.
export function createLocalPeerCapability(): LocalPeerService {
  const candidate = (config.localPeer as { offlineChannel?: unknown } | undefined)?.offlineChannel
  const offlineChannel = typeof candidate === 'number' ? candidate : undefined
  const id = getMacAddress().replaceAll(':', '').toUpperCase()
  return new LocalPeerService(id, localPeerRadioRegistry, { offlineChannel })
}
