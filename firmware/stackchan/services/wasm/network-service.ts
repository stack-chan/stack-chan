export class NetworkService {
  // biome-ignore lint/complexity/noUselessConstructor: wasm stub keeps constructor options compatible with native services.
  constructor(_options?: unknown) {}
  close() {}
  connect(onConnected?: () => void, _onError?: (message: string) => void) {
    onConnected?.()
  }
  scanAndConnect(onConnected?: () => void, _onError?: (message: string) => void) {
    onConnected?.()
  }
}
