import { bootWiFiFailureMessage } from 'boot-network-recovery'
import { BootSession, type HostBootServicesOptions } from 'boot-session'
import { createLocalPeerCapability } from 'local-peer-capability'
import { localize } from 'localization'
import { networkAvailability, openNetworkConnection } from 'network-manager'
import Timer from 'timer'

export type { BootWiFiStatus, HostBootServicesOptions } from 'boot-session'
export type { NetworkReadyResult } from 'network-types'
export type HostBootServices = BootSession
let bootServices: BootSession | undefined

export function startHostBootServices(options: HostBootServicesOptions): HostBootServices {
  let previous = bootServices
  const next = new BootSession(options, {
    beforeStart: () => {
      const owned = previous
      previous = undefined
      return owned?.close() ?? Promise.resolve()
    },
    clock: {
      after(ms, callback) {
        let active = true
        const timer = Timer.set(() => {
          if (active) {
            active = false
            callback()
          }
        }, ms)
        return () => {
          if (active) {
            active = false
            Timer.clear(timer)
          }
        }
      },
    },
    networkAvailability,
    openNetwork: openNetworkConnection,
    createLocalPeer: createLocalPeerCapability,
    connectingMessage: (attempt, maxAttempts) => localize('splash.connecting', { attempt, maxAttempts }),
    failureMessage: bootWiFiFailureMessage,
    report: (message) => trace(`${message}\n`),
  })
  bootServices = next
  return next
}

export function getHostBootServices(): HostBootServices | undefined {
  return bootServices
}
