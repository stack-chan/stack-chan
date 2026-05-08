export class NetworkService {
  constructor(_options?: unknown) {}
  close() {}
  connect(onConnected?: () => void, _onError?: (message: string) => void) {
    onConnected?.()
  }
  scanAndConnect(onConnected?: () => void, _onError?: (message: string) => void) {
    onConnected?.()
  }
}
