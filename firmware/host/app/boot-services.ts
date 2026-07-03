import { connectStoredWiFi } from 'stored-wifi'

export type NetworkReadyResult =
  | {
      status: 'connected'
    }
  | {
      status: 'skipped' | 'failed'
      reason: string
    }

export type HostBootServices = {
  connectivity: {
    network: {
      ready: Promise<NetworkReadyResult>
    }
  }
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
