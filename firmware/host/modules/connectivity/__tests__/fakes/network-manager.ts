export type StartNetworkConnectionOptions = {
  ssid: string
  password: string
  onStateChanged?: (state: unknown) => void
  onConnected?: () => void
  onError?: (reason?: string) => void
}

let started: StartNetworkConnectionOptions[] = []
let stopCount = 0

export function startNetworkConnection(options: StartNetworkConnectionOptions) {
  started.push(options)
  return {
    close() {},
  }
}

export function stopNetworkConnection(): void {
  stopCount += 1
}

export function getNetworkConnection() {
  return started.at(-1)
}

export function resetNetworkManager(): void {
  started = []
  stopCount = 0
}

export function getStartedConnections(): StartNetworkConnectionOptions[] {
  return started
}

export function getStopCount(): number {
  return stopCount
}

export function completeLastConnection(): void {
  started.at(-1)?.onConnected?.()
}

export function failLastConnection(reason?: string): void {
  started.at(-1)?.onError?.(reason)
}
