declare module 'muse-client' {
  /** Experimental Muse owner connection. Credentials are provisioned separately. */
  export interface MuseOptions {
    host: string
    vmId: string
    token: string
    nodeId: string
  }
  export type MuseState =
    | 'stopped'
    | 'connecting'
    | 'noise-handshake'
    | 'registering'
    | 'subscribing'
    | 'ready'
    | 'failed'
  export interface MuseCallbacks {
    onState?(state: MuseState): void
    onText?(delta: string): void
    onSmile?(): void
  }
  export interface MuseConnection {
    readonly state: MuseState
    connect(): void
    sendText(text: string): void
    close(): void
  }
  export function createMuseSession(options: MuseOptions, callbacks?: MuseCallbacks): MuseConnection
}
