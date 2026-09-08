import type { JsonValue, Peer, PeerMessage, PeerOptions } from 'stackchan/extensions/network'
import type { CancellationSignal, OperationOptions } from 'stackchan/task'

// Wire services retain delivery receipts internally; app data types come from the SDK.
export type { JsonValue }
export type LocalPeerInfo = Peer
export type LocalPeerMessage = PeerMessage
export type LocalPeerOpenOptions = PeerOptions

export type LocalPeerDeliveryReceipt = {
  messageId: string
  peerId: string
  attempts: number
}

export type LocalPeerBroadcastReceipt = {
  messageId: string
}

export type LocalPeerSession = {
  discover(options?: OperationOptions & { timeoutMs?: number }): Promise<readonly LocalPeerInfo[]>
  send(peerId: string, type: string, payload: JsonValue, options?: OperationOptions): Promise<LocalPeerDeliveryReceipt>
  broadcast(type: string, payload: JsonValue, options?: OperationOptions): Promise<LocalPeerBroadcastReceipt>
  subscribe(type: string | '*', handler: (message: LocalPeerMessage) => void): () => void
  close(): void
}

export type LocalPeerCapability = {
  readonly id: string
  open(options: LocalPeerOpenOptions, signal?: CancellationSignal): Promise<LocalPeerSession>
}
