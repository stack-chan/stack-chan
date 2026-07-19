export type LocalPeerRadioReceiveEvent = {
  peerId: string
  data: ArrayBuffer
  secure: boolean
}

export type LocalPeerRadioOptions = {
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
