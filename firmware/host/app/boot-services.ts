import config from 'mc/config'
import { wait } from 'stackchan-util'
import { connectStoredWiFi, stopStoredWiFiConnection } from 'stored-wifi'
import type { NetworkReadyResult } from 'capabilities'
import {
  bootWiFiFailureMessage,
  networkReadyResultForRecoveryChoice,
  shouldRetryBootWiFiAttempt,
  type BootWiFiRecoveryChoice,
} from 'boot-network-recovery'

export type { NetworkReadyResult } from 'capabilities'

export type HostBootServices = {
  connectivity: {
    network: {
      ready: Promise<NetworkReadyResult>
    }
  }
}

export type BootWiFiStatus = {
  attempt: number
  maxAttempts: number
  message: string
}

export type HostBootServicesOptions = {
  wifi?: {
    maxAttempts?: number
    retryDelayMs?: number
    onStatusChanged?: (status: BootWiFiStatus) => void
    promptRecoveryChoice?: (status: BootWiFiStatus & { reason: string }) => Promise<BootWiFiRecoveryChoice>
  }
}

type BootWiFiConfig = {
  ssid?: unknown
  password?: unknown
}

type BootConfig = {
  wifi?: BootWiFiConfig
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

export function startHostBootServices(options: HostBootServicesOptions = {}): HostBootServices {
  const networkReady = startStoredWiFi(options.wifi)
  bootServices = {
    connectivity: {
      network: {
        ready: networkReady,
      },
    },
  }
  return bootServices
}

export function getHostBootServices(): HostBootServices {
  return bootServices
}

async function startStoredWiFi(options: NonNullable<HostBootServicesOptions['wifi']> = {}): Promise<NetworkReadyResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_BOOT_WIFI_MAX_ATTEMPTS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_BOOT_WIFI_RETRY_DELAY_MS
  for (;;) {
    let lastReason = 'connection failed'
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      options.onStatusChanged?.({
        attempt,
        maxAttempts,
        message: 'Wi-Fi接続中...',
      })
      const result = await connectStoredWiFiOnce()
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

function connectStoredWiFiOnce(): Promise<NetworkReadyResult> {
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
        ...getBootWiFiCredentials(),
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

function getBootWiFiCredentials(): { ssid?: string; password?: string } {
  const bootConfig = config as BootConfig
  const wifi = bootConfig.wifi ?? {}
  const ssid = wifi.ssid
  const password = wifi.password
  return {
    ssid: typeof ssid === 'string' ? ssid : undefined,
    password: typeof password === 'string' ? password : undefined,
  }
}
