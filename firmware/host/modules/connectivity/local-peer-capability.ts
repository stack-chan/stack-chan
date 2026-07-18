import createLocalPeerRadio, { getLocalPeerId } from 'local-peer-radio'
import { LocalPeerService } from 'local-peer-service'
import type { LocalPeerCapability } from 'local-peer-types'
import config from 'mc/config'

// The platform manifest binds `local-peer-radio`; this composition root is the
// only layer that connects the public communication contract to a radio driver.
export function createLocalPeerCapability(): LocalPeerCapability {
  const candidate = (config.localPeer as { offlineChannel?: unknown } | undefined)?.offlineChannel
  const offlineChannel = typeof candidate === 'number' ? candidate : undefined
  return new LocalPeerService(getLocalPeerId(), createLocalPeerRadio, { offlineChannel })
}
