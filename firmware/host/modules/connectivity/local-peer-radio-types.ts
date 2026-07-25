export type LocalPeerRadioReceiveEvent = {
  peerId: string
  data: ArrayBuffer
  secure: boolean
}

export type LocalPeerRadioOptions = {
  id: string
  offlineChannel: number
  sharedKey?: string
  onReceive: (event: LocalPeerRadioReceiveEvent) => void
}

export interface LocalPeerRadio {
  readonly id: string
  addPeer(peerId: string, secure: boolean): void
  removePeer(peerId: string): void
  send(peerId: string | undefined, data: ArrayBuffer): Promise<void>
  close(): void
}

export type LocalPeerRadioFactory = (options: LocalPeerRadioOptions) => LocalPeerRadio

export type LocalPeerTransport = 'espnow' | 'ble'

export type LocalPeerRadioRegistry = {
  readonly defaultTransport: LocalPeerTransport
  readonly factories: Partial<Record<LocalPeerTransport, LocalPeerRadioFactory>>
}
