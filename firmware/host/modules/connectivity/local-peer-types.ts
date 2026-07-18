export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [key: string]: JsonValue
    }

export type LocalPeerInfo = {
  /** Stable, opaque identifier. Applications must not interpret its format. */
  id: string
  name?: string
  /** True after authenticated point-to-point traffic has been observed. */
  secure: boolean
}

export type LocalPeerMessage = {
  id: string
  peer: LocalPeerInfo
  type: string
  payload: JsonValue
}

export type LocalPeerErrorCode =
  | 'not-supported'
  | 'invalid-argument'
  | 'peer-unavailable'
  | 'message-too-large'
  | 'timeout'
  | 'closed'
  | 'transport'

export class LocalPeerError extends Error {
  readonly code: LocalPeerErrorCode

  constructor(code: LocalPeerErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

LocalPeerError.prototype.name = 'LocalPeerError'

export type LocalPeerOpenOptions = {
  /** Logical application namespace. Only peers using the same service can communicate. */
  service: string
  /** Human-readable name announced during discovery. */
  displayName?: string
  /** Optional pre-shared passphrase used to protect point-to-point messages. */
  sharedKey?: string
}

export type LocalPeerDeliveryReceipt = {
  messageId: string
  peerId: string
  attempts: number
}

export type LocalPeerBroadcastReceipt = {
  messageId: string
}

export type LocalPeerSession = {
  discover(options?: { timeoutMs?: number }): Promise<readonly LocalPeerInfo[]>
  send(peerId: string, type: string, payload: JsonValue): Promise<LocalPeerDeliveryReceipt>
  broadcast(type: string, payload: JsonValue): Promise<LocalPeerBroadcastReceipt>
  subscribe(type: string | '*', handler: (message: LocalPeerMessage) => void): () => void
  close(): void
}

export type LocalPeerCapability = {
  readonly id: string
  open(options: LocalPeerOpenOptions): Promise<LocalPeerSession>
}
