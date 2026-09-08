import { NetworkService } from 'network-service'
import { NetworkConnectionState } from 'network-state'
import type { NetworkConnection, StartNetworkConnectionOptions } from 'network-types'
import { finiteNumber, StackchanError } from 'stackchan/errors'
import { validateSetting } from 'stackchan/settings-schema'

export type { NetworkConnection, StartNetworkConnectionOptions } from 'network-types'
export const networkAvailability = NetworkService.availability
type ActiveNetwork = {
  service: NetworkService
  owners: Map<NetworkConnection, StartNetworkConnectionOptions>
  faulted: boolean
  closing: boolean
}
let current: ActiveNetwork | undefined
let legacy: NetworkConnection[] = []

/** Matching consumers share one radio; a different network requires releasing its existing owners. */
export function openNetworkConnection(options: StartNetworkConnectionOptions): NetworkConnection {
  if (networkAvailability === 'unavailable')
    throw new StackchanError('UNSUPPORTED', 'Wi-Fi is unavailable on this target')
  const ssid = validateSetting('wifi.ssid', options.ssid)
  const password = validateSetting('wifi.password', options.password ?? '')
  if (!ssid.valid || !password.valid) throw new StackchanError('INVALID_ARGUMENT', 'Invalid Wi-Fi credentials')
  if (!ssid.value) throw new StackchanError('CONFIG', 'Wi-Fi SSID is missing')
  finiteNumber(options.connectionTimeoutMs ?? 15_000, 'connectionTimeoutMs', 1, 120_000)
  finiteNumber(options.reconnectDelayMs ?? 3000, 'reconnectDelayMs', 0, 60_000)
  let record = current
  if (record?.faulted || record?.closing) throw new StackchanError('IO', 'Wi-Fi cleanup failed; restart is required')
  if (record?.service.closed) throw new StackchanError('CLOSED', 'The Wi-Fi adapter was closed outside its owner')
  if (record && !record.service.matchesCredentials(options))
    throw new StackchanError('BUSY', 'Wi-Fi is owned by another connection')
  if (record && record.owners.size >= 16) throw new StackchanError('BUSY', 'Too many Wi-Fi consumers')
  const created = !record
  if (!record) {
    const service = new NetworkService({
      ssid: options.ssid,
      password: options.password,
      connectionTimeoutMs: options.connectionTimeoutMs,
      reconnectDelayMs: options.reconnectDelayMs,
      onStateChanged: (state, reason) => {
        if (record) publish(record, (owner) => owner.onStateChanged?.(state, reason))
      },
    })
    record = { service, owners: new Map(), faulted: false, closing: false }
    current = record
  }
  const owned = record
  let closed = false
  let closeError: unknown
  let closeFailed = false
  const connection: NetworkConnection = {
    get state() {
      return closed ? NetworkConnectionState.CLOSED : owned.service.state
    },
    get closed() {
      return closed
    },
    close() {
      if (closed) {
        if (closeFailed) throw closeError
        return
      }
      closed = true
      owned.owners.delete(connection)
      if (owned.owners.size) return
      owned.closing = true
      try {
        owned.service.close()
        if (current === owned) current = undefined
      } catch (error) {
        owned.faulted = true
        closeFailed = true
        closeError = error
        throw error
      } finally {
        owned.closing = false
      }
    },
  }
  owned.owners.set(connection, { ...options })
  try {
    if (created) {
      const connected = () => publish(owned, (owner) => owner.onConnected?.())
      const failed = (reason?: string) => publish(owned, (owner) => owner.onError?.(reason))
      if (options.scanBeforeConnect) owned.service.scanAndConnect(connected, failed)
      else owned.service.connect(connected, failed)
    } else if (owned.service.state === NetworkConnectionState.CONNECTED) notify(() => options.onConnected?.())
    else if (owned.service.state === NetworkConnectionState.FAILED) notify(() => options.onError?.('connection failed'))
  } catch (error) {
    connection.close()
    throw error
  }
  return connection
}

function notify(callback: () => void): void {
  try {
    callback()
  } catch {
    trace('[network] consumer callback failed\n')
  }
}
function publish(record: ActiveNetwork, callback: (owner: StartNetworkConnectionOptions) => void): void {
  for (const [connection, owner] of [...record.owners]) if (!connection.closed) notify(() => callback(owner))
}

/** V1 bridge. stopNetworkConnection only releases calls made through this bridge. */
export function startNetworkConnection(options: StartNetworkConnectionOptions): NetworkService {
  if (current && !current.service.matchesCredentials(options)) stopNetworkConnection()
  legacy.push(openNetworkConnection(options))
  if (!current) throw new StackchanError('CLOSED', 'Wi-Fi connection closed while starting')
  return current.service
}
export function stopNetworkConnection(): void {
  const owned = legacy
  legacy = []
  let failure: unknown
  let failed = false
  for (const connection of owned) {
    try {
      connection.close()
    } catch (error) {
      if (!failed) {
        failure = error
        failed = true
      }
    }
  }
  if (failed) throw failure
}
export function getNetworkConnection(): NetworkService | undefined {
  return current?.service
}
