import {
  type BootWiFiRecoveryChoice,
  bootWiFiFailureMessage,
  networkReadyResultForRecoveryChoice,
  shouldRetryBootWiFiAttempt,
} from 'boot-network-recovery'
import type { NetworkReadyResult } from 'capabilities'
import { createLocalPeerCapability } from 'local-peer-capability'
import type { LocalPeerCapability } from 'local-peer-types'
import { localize } from 'localization'
import { wait } from 'stackchan-util'
import { connectStoredWiFi, stopStoredWiFiConnection } from 'stored-wifi'

export type { NetworkReadyResult } from 'capabilities'

export type HostBootServices = {
  connectivity: {
    network: {
      ready: Promise<NetworkReadyResult>
    }
    localPeer?: LocalPeerCapability
  }
}

export type BootWiFiStatus = {
  attempt: number
  maxAttempts: number
  message: string
}

export type HostBootServicesOptions = {
  credentials: { ssid: string; password: string }
  wifi?: {
    maxAttempts?: number
    retryDelayMs?: number
    onStatusChanged?: (status: BootWiFiStatus) => void
    promptRecoveryChoice?: (status: BootWiFiStatus & { reason: string }) => Promise<BootWiFiRecoveryChoice>
  }
}

const NOT_STARTED: NetworkReadyResult = {
  status: 'skipped',
  reason: 'host boot services not started',
}
const DEFAULT_BOOT_WIFI_MAX_ATTEMPTS = 3
const DEFAULT_BOOT_WIFI_RETRY_DELAY_MS = 500

let bootServices: HostBootServices = {
  connectivity: {
    network: {
      ready: Promise.resolve(NOT_STARTED),
    },
  },
}

export function startHostBootServices(options: HostBootServicesOptions): HostBootServices {
  const networkReady = startStoredWiFi(options.credentials, options.wifi)
  const localPeer = createLocalPeerCapability()
  bootServices = {
    connectivity: {
      network: {
        ready: networkReady,
      },
      localPeer,
    },
  }
  return bootServices
}

export function getHostBootServices(): HostBootServices {
  return bootServices
}

async function startStoredWiFi(
  credentials: HostBootServicesOptions['credentials'],
  options: NonNullable<HostBootServicesOptions['wifi']> = {},
): Promise<NetworkReadyResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_BOOT_WIFI_MAX_ATTEMPTS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_BOOT_WIFI_RETRY_DELAY_MS
  for (;;) {
    let lastReason = 'connection failed'
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      options.onStatusChanged?.({
        attempt,
        maxAttempts,
        message: localize('splash.connecting', { attempt, maxAttempts }),
      })
      const result = await connectStoredWiFiOnce(credentials)
      if (result.status !== 'failed') {
        return result
      }
      lastReason = result.reason
      trace(`[network] boot Wi-Fi attempt ${attempt}/${maxAttempts} failed: ${lastReason}\n`)
      if (shouldRetryBootWiFiAttempt(attempt, maxAttempts)) {
        await wait(retryDelayMs)
      }
    }

    const message = bootWiFiFailureMessage(lastReason)
    if (!options.promptRecoveryChoice) {
      return { status: 'failed', reason: lastReason }
    }
    const choice = await options.promptRecoveryChoice({
      attempt: maxAttempts,
      maxAttempts,
      message,
      reason: lastReason,
    })
    const result = networkReadyResultForRecoveryChoice(choice, lastReason)
    if (result) {
      trace(`[network] ${result.reason}\n`)
      return result
    }
    trace('[network] retrying Wi-Fi by user request\n')
  }
}

function connectStoredWiFiOnce(credentials: HostBootServicesOptions['credentials']): Promise<NetworkReadyResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: NetworkReadyResult) => {
      if (settled) return
      settled = true
      if (result.status !== 'connected') {
        stopStoredWiFiConnection()
      }
      resolve(result)
    }

    try {
      stopStoredWiFiConnection()
      const started = connectStoredWiFi({
        ...credentials,
        scanBeforeConnect: true,
        onConnected: () => finish({ status: 'connected' }),
        onError: (reason) => {
          const message = reason ?? 'connection failed'
          trace(`[network] connection failed: ${message}\n`)
          finish({ status: 'failed', reason: message })
        },
      })
      if (!started) {
        finish({ status: 'skipped', reason: 'missing Wi-Fi credentials' })
      }
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
      trace(`[network] connection failed: ${message}\n`)
      finish({ status: 'failed', reason: message })
    }
  })
}
