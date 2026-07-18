import type { LocalPeerCapability } from 'local-peer-types'
import createLocalPeerRadio, { getLocalPeerId } from 'local-peer-radio'
import { LocalPeerService } from 'local-peer-service'
import config from 'mc/config'

export function createLocalPeerCapability(): LocalPeerCapability {
  const candidate = (config.localPeer as { offlineChannel?: unknown } | undefined)?.offlineChannel
  const offlineChannel = typeof candidate === 'number' ? candidate : undefined
  return new LocalPeerService(getLocalPeerId(), createLocalPeerRadio, { offlineChannel })
}
