import type { NetworkReadyResult } from 'capabilities'
import config from 'mc/config'
import { connectStoredWiFi } from 'stored-wifi'

export type HostBootServices = {
  connectivity: {
    network: {
      ready: Promise<NetworkReadyResult>
    }
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

let bootServices: HostBootServices = {
  connectivity: {
    network: {
      ready: Promise.resolve(NOT_STARTED),
    },
  },
}

export function startHostBootServices(): HostBootServices {
  const networkReady = startStoredWiFi()
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

function startStoredWiFi(): Promise<NetworkReadyResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: NetworkReadyResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    try {
      const started = connectStoredWiFi({
        ...getBootWiFiCredentials(),
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
